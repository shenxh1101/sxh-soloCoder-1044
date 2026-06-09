import { Command } from 'commander';
import express, { Request, Response, NextFunction } from 'express';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { ConfigManager } from '../utils/config';
import { logger } from '../utils/logger';
import { Route, ResponseCase, ServeOptions, RecordedRequest } from '../types';
import { selectResponseCase, SelectCaseResult } from '../utils/condition';
import { recordRequestToSession } from './session';

interface MockServerOptions extends ServeOptions {
  baseUrl: string;
  corsEnabled: boolean;
  logEnabled: boolean;
  recordEnabled: boolean;
  recordDir: string;
}

export function createServeCommand(): Command {
  const command = new Command('serve');

  command
    .description('启动本地模拟服务器')
    .option('-p, --port <port>', '服务端口')
    .option('-H, --host <host>', '绑定地址', '0.0.0.0')
    .option('-w, --watch', '监听配置文件变化自动重载', false)
    .option('--no-cors', '禁用 CORS')
    .option('--no-log', '禁用请求日志')
    .option('-r, --record', '开启请求录制', false)
    .option('--record-dir <dir>', '录制文件存储目录', '.records')
    .option('--override-case <caseName>', '全局覆盖使用指定场景')
    .option('--override-status <code>', '全局覆盖状态码')
    .option('--override-delay <ms>', '全局覆盖延迟（毫秒）')
    .option('--override-body <json>', '全局覆盖响应体')
    .option('--base-url <url>', 'API 基础路径')
    .action(async (options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();
      const config = configManager.getConfig();

      const port = options.port ? parseInt(options.port, 10) : config.port;
      const host = options.host;
      const baseUrl = options.baseUrl || config.baseUrl;
      const corsEnabled = options.cors !== false;
      const logEnabled = options.log !== false;
      const recordEnabled = options.record === true;
      const recordDir = options.recordDir || '.records';

      const serveOptions: MockServerOptions = {
        port,
        host,
        watch: options.watch,
        recordEnabled,
        recordDir,
        baseUrl,
        corsEnabled,
        logEnabled,
      };

      if (options.overrideStatus) {
        serveOptions.override = serveOptions.override || {};
        serveOptions.override.statusCode = parseInt(options.overrideStatus, 10);
      }
      if (options.overrideDelay) {
        serveOptions.override = serveOptions.override || {};
        serveOptions.override.delay = parseInt(options.overrideDelay, 10);
      }
      if (options.overrideBody) {
        serveOptions.override = serveOptions.override || {};
        try {
          serveOptions.override.body = JSON.parse(options.overrideBody);
        } catch {
          serveOptions.override.body = options.overrideBody;
        }
      }
      if (options.overrideCase) {
        serveOptions.override = serveOptions.override || {};
        serveOptions.override.case = options.overrideCase;
      }

      const server = new MockServer(configManager, serveOptions);

      await server.start();

      if (options.watch) {
        server.watch();
      }

      const handleShutdown = async () => {
        logger.info('\n正在关闭服务器...');
        await server.stop();
        process.exit(0);
      };

      process.on('SIGINT', handleShutdown);
      process.on('SIGTERM', handleShutdown);
    });

  return command;
}

export class MockServer {
  private app: express.Express;
  private server: any;
  private configManager: ConfigManager;
  private options: MockServerOptions;
  private routes: Route[] = [];
  private watcher: any;
  private routesRouter: express.Router;
  private records: RecordedRequest[] = [];

  constructor(configManager: ConfigManager, options: MockServerOptions) {
    this.configManager = configManager;
    this.options = options;
    this.app = express();
    this.routesRouter = express.Router();
    this.setupMiddleware();
  }

  private setupMiddleware(): void {
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    if (this.options.corsEnabled) {
      this.app.use((req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,HEAD,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With');
        if (req.method === 'OPTIONS') {
          return res.status(204).send();
        }
        next();
      });
    }

    if (this.options.logEnabled) {
      this.app.use((req: Request, res: Response, next: NextFunction) => {
        const startTime = Date.now();

        res.on('finish', () => {
          const duration = Date.now() - startTime;
          const methodColor = this.getMethodColor(req.method);
          const statusColor = this.getStatusColor(res.statusCode);

          logger.raw(
            `${chalk.gray(new Date().toLocaleTimeString())} ` +
            `${methodColor(req.method)} ` +
            `${chalk.cyan(req.originalUrl)} ` +
            `${statusColor(res.statusCode.toString())} ` +
            `${chalk.gray(duration + 'ms')}`
          );
        });

        next();
      });
    }

    this.app.use(this.routesRouter);
  }

  async loadRoutes(): Promise<void> {
    this.routes = await this.configManager.loadAllRoutes();
    this.registerRoutes();
    logger.info(`已加载 ${chalk.bold(this.routes.length)} 个路由配置`);
  }

  private registerRoutes(): void {
    this.routesRouter.stack = [];

    for (const route of this.routes) {
      const fullPath = (this.options.baseUrl + route.path).replace(/\/+/g, '/');
      const method = route.method.toLowerCase();

      (this.routesRouter as any)[method](fullPath, async (req: Request, res: Response) => {
        await this.handleRequest(req, res, route);
      });
    }

    this.routesRouter.use((req: Request, res: Response) => {
      res.status(404).json({
        code: 404,
        message: '接口不存在',
        path: req.originalUrl,
        method: req.method,
        availableRoutes: this.routes.map(r => ({
          method: r.method,
          path: this.options.baseUrl + r.path,
        })),
      });
    });
  }

  private async handleRequest(req: Request, res: Response, route: Route): Promise<void> {
    const startTime = Date.now();
    const overrideCase = this.options.override?.case;

    const result = selectResponseCase(
      { cases: route.cases, activeCase: route.activeCase },
      { query: req.query as Record<string, any>, body: req.body, headers: req.headers as Record<string, string> },
      overrideCase
    );

    const responseCase = result.selectedCase;

    let statusCode = responseCase.statusCode;
    let delay = responseCase.delay || 0;
    let body = responseCase.body;
    let headers = responseCase.headers || {};

    if (this.options.override) {
      if (this.options.override.statusCode !== undefined) {
        statusCode = this.options.override.statusCode;
      }
      if (this.options.override.delay !== undefined) {
        delay = this.options.override.delay;
      }
      if (this.options.override.body !== undefined) {
        body = this.options.override.body;
      }
    }

    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }

    res.status(statusCode);

    if (typeof body === 'string') {
      res.send(body);
    } else {
      res.json(body);
    }

    if (this.options.recordEnabled) {
      const duration = Date.now() - startTime;
      this.recordRequest(req, route, responseCase, result, statusCode, delay, headers, body, duration);
    }
  }

  private async recordRequest(
    req: Request,
    route: Route,
    responseCase: ResponseCase,
    result: SelectCaseResult,
    statusCode: number,
    delay: number,
    headers: Record<string, string>,
    body: any,
    duration: number
  ): Promise<void> {
    const record: RecordedRequest = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      method: req.method as any,
      path: route.path,
      fullUrl: req.originalUrl,
      query: { ...(req.query as Record<string, any>) },
      body: req.body,
      headers: { ...(req.headers as Record<string, string>) },
      response: {
        statusCode,
        delay,
        headers: { ...headers },
        body,
        caseName: responseCase.name,
        selectionReason: result.selectionReason,
      },
      duration,
    };

    this.records.push(record);

    try {
      const recordDir = path.join(this.configManager.getConfig() ? process.cwd() : '.', this.options.recordDir);
      await fs.mkdirp(recordDir);

      const dateStr = new Date().toISOString().split('T')[0];
      const filePath = path.join(recordDir, `${dateStr}.json`);

      let existingRecords: RecordedRequest[] = [];
      if (await fs.pathExists(filePath)) {
        existingRecords = await fs.readJson(filePath);
      }
      existingRecords.push(record);
      await fs.writeJson(filePath, existingRecords, { spaces: 2 });

      const summaryPath = path.join(recordDir, 'latest.json');
      await fs.writeJson(summaryPath, this.records.slice(-100), { spaces: 2 });

      await recordRequestToSession(record);
    } catch (error) {
      logger.debug(`保存录制记录失败: ${(error as Error).message}`);
    }
  }

  async start(): Promise<void> {
    await this.loadRoutes();

    return new Promise((resolve) => {
      this.server = this.app.listen(this.options.port!, this.options.host!, () => {
        const config = this.configManager.getConfig();
        logger.success(`Mock 服务器已启动`);
        logger.raw('');
        logger.raw(chalk.cyan('服务信息:'));
        logger.raw(`  地址: http://${this.options.host}:${this.options.port}`);
        logger.raw(`  基础路径: ${this.options.baseUrl}`);
        logger.raw(`  CORS: ${this.options.corsEnabled ? chalk.green('已启用') : chalk.red('已禁用')}`);
        logger.raw(`  请求日志: ${this.options.logEnabled ? chalk.green('已启用') : chalk.red('已禁用')}`);
        if (this.options.recordEnabled) {
          logger.raw(`  请求录制: ${chalk.green('已启用')} (目录: ${this.options.recordDir})`);
        }
        if (this.options.watch) {
          logger.raw(`  配置监听: ${chalk.green('已启用')}`);
        }
        logger.raw(`  项目: ${config.name} v${config.version}`);
        logger.raw('');
        logger.raw(chalk.cyan('可用接口:'));
        for (const route of this.routes) {
          const fullPath = this.configManager.getFullPath(route.path);
          logger.raw(`  ${this.getMethodColor(route.method)(route.method)} ${chalk.cyan(`http://localhost:${this.options.port}${fullPath}`)}`);
        }
        logger.raw('');
        if (this.options.override) {
          logger.warning(`全局覆盖已启用: ${JSON.stringify(this.options.override)}`);
        }
        if (this.options.recordEnabled) {
          logger.info(`录制记录将保存到: ${path.join(process.cwd(), this.options.recordDir)}`);
          logger.info(`使用 'mock record list' 查看录制记录`);
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
    }
    if (this.server) {
      return new Promise((resolve, reject) => {
        this.server.close((err: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  watch(): void {
    const routesDir = this.configManager.getRoutesDir();

    try {
      this.watcher = fs.watch(routesDir, { recursive: true }, async (event, filename) => {
        if (filename && !filename.startsWith('.')) {
          const filePath = filename.toString();
          logger.info(`检测到配置变化 (${event}): ${filePath}`);
          try {
            await new Promise(resolve => setTimeout(resolve, 300));
            await this.loadRoutes();
            logger.success('路由配置已重新加载');
            logger.raw(chalk.cyan('当前接口:'));
            for (const route of this.routes) {
              const fullPath = (this.options.baseUrl + route.path).replace(/\/+/g, '/');
              logger.raw(`  ${this.getMethodColor(route.method)(route.method)} ${chalk.cyan(fullPath)}`);
            }
          } catch (error) {
            logger.error(`重新加载失败: ${(error as Error).message}`);
          }
        }
      });

      logger.info(`已启用配置监听: ${routesDir}`);
    } catch (error) {
      logger.warning(`无法启用配置监听: ${(error as Error).message}`);
      logger.info('将不使用自动重载功能，修改配置后需要手动重启服务');
    }
  }

  private getMethodColor(method: string): (text: string) => string {
    const colors: Record<string, (text: string) => string> = {
      GET: chalk.green,
      POST: chalk.blue,
      PUT: chalk.yellow,
      DELETE: chalk.red,
      PATCH: chalk.magenta,
      HEAD: chalk.gray,
      OPTIONS: chalk.gray,
    };
    return colors[method] || chalk.white;
  }

  private getStatusColor(status: number): (text: string) => string {
    if (status < 300) return chalk.green;
    if (status < 400) return chalk.yellow;
    if (status < 500) return chalk.red;
    return chalk.bgRed.white;
  }
}
