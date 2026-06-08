import { Command } from 'commander';
import express, { Request, Response, NextFunction } from 'express';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { ConfigManager } from '../utils/config';
import { logger } from '../utils/logger';
import { Route, ResponseCase, ParameterCondition, ServeOptions } from '../types';

export function createServeCommand(): Command {
  const command = new Command('serve');

  command
    .description('启动本地模拟服务器')
    .option('-p, --port <port>', '服务端口')
    .option('-H, --host <host>', '绑定地址', '0.0.0.0')
    .option('-w, --watch', '监听配置文件变化自动重载', false)
    .option('--no-cors', '禁用 CORS')
    .option('--no-log', '禁用请求日志')
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

      const serveOptions: ServeOptions = {
        port,
        host,
        watch: options.watch,
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

      const server = new MockServer(configManager, {
        ...serveOptions,
        baseUrl,
        corsEnabled,
        logEnabled,
      });

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

interface MockServerOptions extends ServeOptions {
  baseUrl: string;
  corsEnabled: boolean;
  logEnabled: boolean;
}

export class MockServer {
  private app: express.Express;
  private server: any;
  private configManager: ConfigManager;
  private options: MockServerOptions;
  private routes: Route[] = [];
  private watcher: any;
  private routesRouter: express.Router;

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
    const responseCase = this.selectResponseCase(req, route);

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
  }

  private selectResponseCase(req: Request, route: Route): ResponseCase {
    if (this.options.override?.case) {
      const overrideCase = route.cases.find(c => c.name === this.options.override!.case);
      if (overrideCase) {
        return overrideCase;
      }
    }

    for (const caseItem of route.cases) {
      if (caseItem.conditions && this.checkConditions(req, caseItem.conditions)) {
        return caseItem;
      }
    }

    if (route.activeCase) {
      const activeCase = route.cases.find(c => c.name === route.activeCase);
      if (activeCase) {
        return activeCase;
      }
    }

    const defaultCase = route.cases.find(c => c.default);
    if (defaultCase) {
      return defaultCase;
    }

    return route.cases[0];
  }

  private checkConditions(req: Request, conditions: NonNullable<ResponseCase['conditions']>): boolean {
    const checkParamConditions = (params: Record<string, any>, conditions?: ParameterCondition[]): boolean => {
      if (!conditions || conditions.length === 0) return true;

      return conditions.every(condition => {
        const value = params[condition.name];

        if (condition.exists !== undefined) {
          const exists = value !== undefined;
          return condition.exists ? exists : !exists;
        }

        if (value === undefined) return false;

        if (condition.value !== undefined) {
          return String(value) === String(condition.value);
        }

        if (condition.contains !== undefined) {
          return String(value).includes(condition.contains);
        }

        if (condition.matches !== undefined) {
          try {
            const regex = new RegExp(condition.matches);
            return regex.test(String(value));
          } catch {
            return false;
          }
        }

        return true;
      });
    };

    return (
      checkParamConditions(req.query as Record<string, any>, conditions.query) &&
      checkParamConditions(req.body as Record<string, any>, conditions.body) &&
      checkParamConditions(req.headers as Record<string, any>, conditions.headers)
    );
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
        logger.raw(`  项目: ${config.name} v${config.version}`);
        logger.raw('');
        logger.raw(chalk.cyan('可用接口:'));
        for (const route of this.routes) {
          const fullPath = this.options.baseUrl + route.path;
          logger.raw(`  ${this.getMethodColor(route.method)(route.method)} ${chalk.cyan(`http://localhost:${this.options.port}${fullPath}`)}`);
        }
        logger.raw('');
        if (this.options.override) {
          logger.warning(`全局覆盖已启用: ${JSON.stringify(this.options.override)}`);
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
    const chokidar = require('chokidar');

    this.watcher = chokidar.watch(routesDir, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    const handleChange = async (event: string, filePath: string) => {
      const fileName = path.basename(filePath);
      logger.info(`检测到配置变化 (${event}): ${fileName}`);
      try {
        await this.loadRoutes();
        logger.success('路由配置已重新加载');
      } catch (error) {
        logger.error(`重新加载失败: ${(error as Error).message}`);
      }
    };

    this.watcher
      .on('add', (filePath: string) => handleChange('add', filePath))
      .on('change', (filePath: string) => handleChange('change', filePath))
      .on('unlink', (filePath: string) => handleChange('delete', filePath));

    logger.info(`已启用配置监听: ${routesDir}`);
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
