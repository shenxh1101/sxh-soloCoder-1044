import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { ConfigManager } from '../utils/config';
import { logger } from '../utils/logger';
import { RecordedRequest, ResponseCase } from '../types';

export function createRecordCommand(): Command {
  const command = new Command('record');

  command
    .description('管理请求录制记录')
    .addCommand(createListCommand())
    .addCommand(createShowCommand())
    .addCommand(createExportCommand())
    .addCommand(createToCaseCommand())
    .addCommand(createClearCommand());

  return command;
}

function getRecordDir(configManager: ConfigManager, customDir?: string): string {
  const recordDir = customDir || '.records';
  return path.join(process.cwd(), recordDir);
}

async function loadRecords(recordDir: string, date?: string): Promise<RecordedRequest[]> {
  if (date) {
    const filePath = path.join(recordDir, `${date}.json`);
    if (await fs.pathExists(filePath)) {
      return fs.readJson(filePath);
    }
    return [];
  }

  const latestPath = path.join(recordDir, 'latest.json');
  if (await fs.pathExists(latestPath)) {
    return fs.readJson(latestPath);
  }

  const files = await fs.readdir(recordDir);
  const jsonFiles = files.filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.json$/)).sort().reverse();

  for (const file of jsonFiles) {
    const records = await fs.readJson(path.join(recordDir, file));
    if (records.length > 0) {
      return records;
    }
  }

  return [];
}

function getMethodColor(method: string): (text: string) => string {
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

function createListCommand(): Command {
  return new Command('list')
    .description('列出录制记录')
    .option('-d, --date <date>', '指定日期 (YYYY-MM-DD)，默认最新')
    .option('-r, --record-dir <dir>', '录制目录', '.records')
    .option('-n, --limit <n>', '显示最近 N 条', '20')
    .option('-m, --method <method>', '按方法筛选')
    .option('-p, --path <path>', '按路径筛选')
    .action(async (options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();

      const recordDir = getRecordDir(configManager, options.recordDir);

      if (!(await fs.pathExists(recordDir))) {
        logger.warning('暂无录制记录');
        logger.info('使用 mock serve -r 开启请求录制');
        return;
      }

      let records = await loadRecords(recordDir, options.date);
      const limit = parseInt(options.limit, 10);

      if (options.method) {
        records = records.filter(r => r.method.toUpperCase() === options.method.toUpperCase());
      }
      if (options.path) {
        records = records.filter(r => r.path.includes(options.path));
      }

      if (records.length === 0) {
        logger.info('没有符合条件的录制记录');
        return;
      }

      const displayRecords = records.slice(-limit).reverse();

      logger.raw('');
      logger.raw(chalk.cyan(`📋 录制记录 (${displayRecords.length}/${records.length} 条):`));
      logger.raw('');

      for (const record of displayRecords) {
        const time = new Date(record.timestamp).toLocaleTimeString();
        const statusColor = record.response.statusCode < 300 ? chalk.green : chalk.red;

        logger.raw(
          `${chalk.gray(time)} ` +
          `${chalk.gray(record.id.slice(-8))} ` +
          `${getMethodColor(record.method)(record.method)} ` +
          `${chalk.cyan(record.path)} ` +
          `${statusColor(record.response.statusCode)} ` +
          `${chalk.yellow(record.response.caseName)} ` +
          `${chalk.gray(record.duration + 'ms')}`
        );
      }

      logger.raw('');
      logger.info(`使用 mock record show <id> 查看详情`);
    });
}

function createShowCommand(): Command {
  return new Command('show')
    .description('查看录制记录详情')
    .arguments('<id>')
    .option('-r, --record-dir <dir>', '录制目录', '.records')
    .action(async (id: string, options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();

      const recordDir = getRecordDir(configManager, options.recordDir);
      const records = await loadRecords(recordDir);
      const record = records.find(r => r.id === id || r.id.endsWith(id));

      if (!record) {
        logger.error(`找不到录制记录: ${id}`);
        process.exit(1);
      }

      logger.raw('');
      logger.raw(chalk.cyan('='.repeat(80)));
      logger.raw(chalk.cyan.bold(`  录制记录详情: ${record.id}`));
      logger.raw(chalk.cyan('='.repeat(80)));
      logger.raw('');

      logger.raw(chalk.bold('📥 请求信息:'));
      logger.raw(`  ${chalk.magenta('时间:')} ${new Date(record.timestamp).toLocaleString()}`);
      logger.raw(`  ${chalk.magenta('方法:')} ${record.method}`);
      logger.raw(`  ${chalk.magenta('路径:')} ${record.path}`);
      logger.raw(`  ${chalk.magenta('完整URL:')} ${record.fullUrl}`);
      logger.raw(`  ${chalk.magenta('耗时:')} ${record.duration}ms`);

      if (Object.keys(record.query).length > 0) {
        logger.raw(`  ${chalk.magenta('Query:')} ${JSON.stringify(record.query, null, 2).split('\n').join('\n  ')}`);
      }
      if (record.body && Object.keys(record.body).length > 0) {
        logger.raw(`  ${chalk.magenta('Body:')} ${JSON.stringify(record.body, null, 2).split('\n').join('\n  ')}`);
      }
      logger.raw('');

      logger.raw(chalk.bold('📤 响应信息:'));
      logger.raw(`  ${chalk.magenta('状态码:')} ${record.response.statusCode}`);
      logger.raw(`  ${chalk.magenta('模拟延迟:')} ${record.response.delay}ms`);
      logger.raw(`  ${chalk.magenta('命中场景:')} ${chalk.yellow(record.response.caseName)}`);
      logger.raw(`  ${chalk.magenta('命中原因:')} ${record.response.selectionReason}`);
      if (Object.keys(record.response.headers).length > 0) {
        logger.raw(`  ${chalk.magenta('响应头:')} ${JSON.stringify(record.response.headers)}`);
      }
      logger.raw(`  ${chalk.magenta('响应体:')}`);
      const bodyStr = typeof record.response.body === 'string'
        ? record.response.body
        : JSON.stringify(record.response.body, null, 2);
      logger.raw(`  ${bodyStr.split('\n').join('\n  ')}`);
      logger.raw('');

      logger.raw(chalk.cyan('='.repeat(80)));
      logger.info(`使用 mock record to-case ${id} --name <name> 转成新的 case`);
    });
}

function createExportCommand(): Command {
  return new Command('export')
    .description('导出录制记录')
    .option('-d, --date <date>', '指定日期 (YYYY-MM-DD)，默认全部')
    .option('-r, --record-dir <dir>', '录制目录', '.records')
    .option('-o, --output <file>', '输出文件', 'records.json')
    .option('-f, --format <format>', '格式: json|markdown', 'json')
    .action(async (options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();

      const recordDir = getRecordDir(configManager, options.recordDir);

      if (!(await fs.pathExists(recordDir))) {
        logger.error('暂无录制记录');
        process.exit(1);
      }

      const records = await loadRecords(recordDir, options.date);

      if (records.length === 0) {
        logger.warning('没有可导出的录制记录');
        return;
      }

      let content: string;
      if (options.format === 'markdown') {
        content = generateMarkdownReport(records);
      } else {
        content = JSON.stringify(records, null, 2);
      }

      const outputPath = path.resolve(options.output);
      await fs.writeFile(outputPath, content);
      logger.success(`已导出 ${records.length} 条录制记录到: ${chalk.cyan(outputPath)}`);
    });
}

function createToCaseCommand(): Command {
  return new Command('to-case')
    .description('将录制记录转成新的 case')
    .arguments('<id>')
    .requiredOption('-n, --name <name>', '新 case 的名称')
    .option('-d, --description <desc>', 'case 描述')
    .option('--default', '设为默认 case', false)
    .option('-r, --record-dir <dir>', '录制目录', '.records')
    .action(async (id: string, options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();

      const recordDir = getRecordDir(configManager, options.recordDir);
      const records = await loadRecords(recordDir);
      const record = records.find(r => r.id === id || r.id.endsWith(id));

      if (!record) {
        logger.error(`找不到录制记录: ${id}`);
        process.exit(1);
      }

      const route = await configManager.loadRoute(record.method, record.path);
      if (!route) {
        logger.error(`路由不存在: ${record.method} ${record.path}`);
        logger.info('请先使用 mock route add 创建路由');
        process.exit(1);
      }

      const existingCase = route.cases.find(c => c.name === options.name);
      if (existingCase) {
        logger.error(`case 名称已存在: ${options.name}`);
        process.exit(1);
      }

      const convertConditions = (obj: Record<string, any> | undefined | null): { name: string; value: string | number | boolean }[] | undefined => {
        if (!obj || Object.keys(obj).length === 0) return undefined;
        return Object.entries(obj).map(([name, value]) => ({
          name,
          value: typeof value === 'object' ? JSON.stringify(value) : value as string | number | boolean,
        }));
      };

      const newCase: ResponseCase = {
        name: options.name,
        description: options.description || `从录制记录 ${record.id} 转换`,
        statusCode: record.response.statusCode,
        delay: record.response.delay,
        headers: Object.keys(record.response.headers).length > 0 ? record.response.headers : undefined,
        body: record.response.body,
        conditions: {
          query: convertConditions(record.query),
          body: convertConditions(record.body),
        },
        default: options.default,
      };

      if (options.default) {
        route.cases.forEach(c => { c.default = false; });
      }

      route.cases.push(newCase);
      route.updatedAt = new Date().toISOString();

      await configManager.saveRoute(route);
      logger.success(`已将录制记录转换为新 case: ${chalk.yellow(options.name)}`);
      logger.raw('');
      logger.raw(chalk.cyan('转换结果:'));
      logger.raw(`  方法: ${record.method}`);
      logger.raw(`  路径: ${record.path}`);
      logger.raw(`  Case: ${options.name}`);
      logger.raw(`  状态码: ${record.response.statusCode}`);
      if (newCase.conditions?.query?.length) {
        logger.raw(`  Query 条件: ${newCase.conditions.query.map(c => `${c.name}=${c.value}`).join(', ')}`);
      }
      if (newCase.conditions?.body?.length) {
        logger.raw(`  Body 条件: ${newCase.conditions.body.map(c => `${c.name}=${c.value}`).join(', ')}`);
      }
    });
}

function createClearCommand(): Command {
  return new Command('clear')
    .description('清除录制记录')
    .option('-d, --date <date>', '指定日期 (YYYY-MM-DD)，默认清除所有')
    .option('-r, --record-dir <dir>', '录制目录', '.records')
    .option('-y, --yes', '跳过确认', false)
    .action(async (options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();

      const recordDir = getRecordDir(configManager, options.recordDir);

      if (!(await fs.pathExists(recordDir))) {
        logger.info('没有录制记录需要清除');
        return;
      }

      if (!options.yes) {
        const inquirer = require('inquirer');
        const answer = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: options.date
              ? `确认清除 ${options.date} 的录制记录?`
              : '确认清除所有录制记录?',
            default: false,
          },
        ]);
        if (!answer.confirm) {
          logger.info('已取消');
          return;
        }
      }

      if (options.date) {
        const filePath = path.join(recordDir, `${options.date}.json`);
        if (await fs.pathExists(filePath)) {
          await fs.remove(filePath);
          logger.success(`已清除 ${options.date} 的录制记录`);
        } else {
          logger.info(`没有 ${options.date} 的录制记录`);
        }
      } else {
        await fs.emptyDir(recordDir);
        logger.success('已清除所有录制记录');
      }
    });
}

function generateMarkdownReport(records: RecordedRequest[]): string {
  const lines: string[] = [];

  lines.push('# 请求录制记录');
  lines.push('');
  lines.push(`**生成时间**: ${new Date().toLocaleString()}`);
  lines.push(`**记录数量**: ${records.length}`);
  lines.push('');
  lines.push('## 记录列表');
  lines.push('');
  lines.push('| 时间 | 方法 | 路径 | 状态码 | 场景 | 耗时 |');
  lines.push('|------|------|------|--------|------|------|');

  for (const record of records) {
    const time = new Date(record.timestamp).toLocaleString();
    lines.push(`| ${time} | ${record.method} | \`${record.path}\` | ${record.response.statusCode} | ${record.response.caseName} | ${record.duration}ms |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  for (const record of records) {
    lines.push(`## ${record.method} ${record.path}`);
    lines.push('');
    lines.push(`- **时间**: ${new Date(record.timestamp).toLocaleString()}`);
    lines.push(`- **状态码**: ${record.response.statusCode}`);
    lines.push(`- **场景**: ${record.response.caseName}`);
    lines.push(`- **命中原因**: ${record.response.selectionReason}`);
    lines.push(`- **耗时**: ${record.duration}ms`);
    lines.push('');

    if (Object.keys(record.query).length > 0) {
      lines.push('### Query 参数');
      lines.push('```json');
      lines.push(JSON.stringify(record.query, null, 2));
      lines.push('```');
      lines.push('');
    }

    if (record.body && Object.keys(record.body).length > 0) {
      lines.push('### Body 参数');
      lines.push('```json');
      lines.push(JSON.stringify(record.body, null, 2));
      lines.push('```');
      lines.push('');
    }

    lines.push('### 响应体');
    lines.push('```json');
    const bodyStr = typeof record.response.body === 'string'
      ? record.response.body
      : JSON.stringify(record.response.body, null, 2);
    lines.push(bodyStr);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}
