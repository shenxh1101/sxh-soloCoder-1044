import { Command } from 'commander';
import chalk from 'chalk';
import * as http from 'http';
import { ConfigManager } from '../utils/config';
import { logger } from '../utils/logger';
import { RecordedRequest } from '../types';
import { getRecordDir, loadRecords, getRecord } from '../commands/record';

function createReplayAllCommand(): Command {
  return new Command('all')
    .description('按时间顺序回放所有录制记录')
    .option('--delay <ms>', '请求间隔延迟(ms)', '500')
    .option('--stop-on-error', '遇到错误时停止', false)
    .action(async (options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();
      const config = configManager.getConfig();

      const recordDir = getRecordDir(configManager);
      const records = await loadRecords(recordDir);

      if (records.length === 0) {
        logger.error('没有录制记录');
        process.exit(1);
      }

      const sortedRecords = records.sort((a: RecordedRequest, b: RecordedRequest) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      logger.raw('');
      logger.info(`准备回放 ${chalk.yellow(sortedRecords.length)} 条录制记录`);
      logger.raw(`  ${chalk.gray('目标地址:')} http://localhost:${config.port}${config.baseUrl}`);
      logger.raw(`  ${chalk.gray('请求间隔:')} ${options.delay}ms`);
      logger.raw('');

      const delay = parseInt(options.delay, 10);
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < sortedRecords.length; i++) {
        const record = sortedRecords[i];
        logger.raw(chalk.gray(`[${i + 1}/${sortedRecords.length}] `) + 
          chalk.green(record.method) + ' ' + chalk.cyan(record.path));

        try {
          const result = await replayRequest(record, config.port, config.baseUrl);
          if (result.success) {
            successCount++;
            logger.raw(`  ${chalk.green('✓')} 状态码: ${result.statusCode}, 耗时: ${result.duration}ms`);
          } else {
            failCount++;
            logger.raw(`  ${chalk.red('✗')} ${result.error}`);
            if (options.stopOnError) {
              logger.error('遇到错误，停止回放');
              break;
            }
          }
        } catch (error) {
          failCount++;
          logger.raw(`  ${chalk.red('✗')} ${(error as Error).message}`);
          if (options.stopOnError) {
            logger.error('遇到错误，停止回放');
            break;
          }
        }

        if (i < sortedRecords.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      logger.raw('');
      logger.raw(chalk.cyan('📊 回放统计:'));
      logger.raw(`  ${chalk.gray('成功:')} ${chalk.green(successCount)}`);
      logger.raw(`  ${chalk.gray('失败:')} ${chalk.red(failCount)}`);
      logger.raw(`  ${chalk.gray('总数:')} ${sortedRecords.length}`);
      logger.raw('');
    });
}

function createServeCommand(): Command {
  return new Command('serve')
    .description('使用录制记录的响应启动临时接口')
    .arguments('<recordId>')
    .option('-p, --port <port>', '临时服务端口', '3002')
    .action(async (recordId: string, options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();
      const baseConfig = configManager.getConfig();

      const recordDir = getRecordDir(configManager);
      const record = await getRecord(recordId, recordDir);

      if (!record) {
        logger.error(`找不到录制记录: ${recordId}`);
        process.exit(1);
      }

      logger.raw('');
      logger.success(`已加载录制记录: ${chalk.yellow(recordId)}`);
      logger.raw('');
      logger.raw(chalk.cyan('📋 录制记录详情:'));
      logger.raw(`  ${chalk.gray('方法:')} ${chalk.green(record.method)}`);
      logger.raw(`  ${chalk.gray('路径:')} ${chalk.cyan(record.path)}`);
      logger.raw(`  ${chalk.gray('状态码:')} ${record.response.statusCode}`);
      logger.raw(`  ${chalk.gray('场景:')} ${record.response.caseName}`);
      logger.raw('');

      const port = parseInt(options.port, 10);
      const fullPath = record.path;

      const server = http.createServer((req, res) => {
        if (req.url === fullPath || req.url?.startsWith(fullPath + '?')) {
          res.writeHead(record.response.statusCode, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            ...record.response.headers,
          });

          setTimeout(() => {
            res.end(JSON.stringify(record.response.body, null, 2));
            logger.raw(`[${new Date().toLocaleTimeString()}] ${chalk.green(req.method)} ${chalk.cyan(req.url)} → ${chalk.yellow(record.response.statusCode)}`);
          }, record.response.delay);
        } else if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          });
          res.end();
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not Found', availablePath: fullPath }));
        }
      });

      server.listen(port, () => {
        logger.raw('');
        logger.success(`临时接口已启动`);
        logger.raw('');
        logger.raw(chalk.cyan('🌐 临时接口地址:'));
        logger.raw(`  ${chalk.cyan(`http://localhost:${port}${fullPath}`)}`);
        logger.raw('');
        logger.raw(chalk.cyan('💡 使用说明:'));
        logger.raw(`  ${chalk.gray('-')} 仅 ${chalk.green(record.method)} ${chalk.cyan(fullPath)} 可用`);
        logger.raw(`  ${chalk.gray('-')} 响应直接使用录制时的结果，不污染正式配置`);
        logger.raw(`  ${chalk.gray('-')} 按 Ctrl+C 停止临时服务`);
        logger.raw('');
        logger.info('等待请求...');
        logger.raw('');
      });

      process.on('SIGINT', () => {
        logger.raw('');
        logger.info('正在停止临时服务...');
        server.close(() => {
          logger.success('临时服务已停止，正式路由配置未受影响');
          process.exit(0);
        });
      });
    });
}

async function replayRequest(
  record: RecordedRequest,
  port: number,
  baseUrl: string
): Promise<{ success: boolean; statusCode?: number; duration?: number; error?: string }> {
  return new Promise((resolve) => {
    const fullPath = (baseUrl + record.path).replace(/\/+/g, '/');
    const queryString = new URLSearchParams(record.query as any).toString();
    const url = queryString ? `${fullPath}?${queryString}` : fullPath;

    const startTime = Date.now();

    const req = http.request({
      hostname: 'localhost',
      port,
      path: url,
      method: record.method,
      headers: {
        'Content-Type': 'application/json',
        ...record.headers,
      },
    }, (res) => {
      const duration = Date.now() - startTime;
      resolve({
        success: res.statusCode === record.response.statusCode,
        statusCode: res.statusCode,
        duration,
        error: res.statusCode !== record.response.statusCode 
          ? `期望 ${record.response.statusCode}，实际 ${res.statusCode}` 
          : undefined,
      });
    });

    req.on('error', (e) => {
      resolve({
        success: false,
        error: e.message,
      });
    });

    if (record.body && Object.keys(record.body).length > 0) {
      req.write(JSON.stringify(record.body));
    }
    req.end();
  });
}

export function createReplayCommand(): Command {
  const command = new Command('replay')
    .description('录制记录回放 - 重放请求或启动临时接口');

  command.addCommand(createReplayAllCommand());
  command.addCommand(createServeCommand());

  return command;
}
