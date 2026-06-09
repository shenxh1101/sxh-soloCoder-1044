import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { ConfigManager } from '../utils/config';
import { logger } from '../utils/logger';
import { Session, SessionOperation, OperationType, RecordedRequest } from '../types';

const SESSION_DIR = '.sessions';

function getSessionDir(cwd: string): string {
  return path.join(cwd, SESSION_DIR);
}

function getActiveSessionPath(cwd: string): string {
  return path.join(getSessionDir(cwd), 'active.json');
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function getActiveSession(cwd: string = process.cwd()): Promise<Session | null> {
  const sessionPath = getActiveSessionPath(cwd);
  if (await fs.pathExists(sessionPath)) {
    const session = await fs.readJson(sessionPath) as Session;
    if (session.active) {
      return session;
    }
  }
  return null;
}

export async function saveActiveSession(session: Session, cwd: string = process.cwd()): Promise<void> {
  const sessionDir = getSessionDir(cwd);
  await fs.mkdirp(sessionDir);
  await fs.writeJson(getActiveSessionPath(cwd), session, { spaces: 2 });
}

export async function recordOperation(
  type: OperationType,
  command: string,
  details: any,
  cwd: string = process.cwd()
): Promise<void> {
  const session = await getActiveSession(cwd);
  if (!session) return;

  const operation: SessionOperation = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    type,
    command,
    details,
  };

  session.operations.push(operation);
  await saveActiveSession(session, cwd);
}

export async function recordRequestToSession(
  request: RecordedRequest,
  cwd: string = process.cwd()
): Promise<void> {
  const session = await getActiveSession(cwd);
  if (!session) return;

  session.recordedRequests.push(request);
  await saveActiveSession(session, cwd);
}

function createStartCommand(): Command {
  return new Command('start')
    .description('启动联调会话，开始记录操作')
    .arguments('<name>')
    .action(async (name: string) => {
      const cwd = process.cwd();
      const configManager = new ConfigManager();
      await configManager.ensureProject();

      const existingSession = await getActiveSession(cwd);
      if (existingSession) {
        logger.error(`已有活跃的会话: ${chalk.yellow(existingSession.name)}`);
        logger.info('先使用 "mock session end" 结束当前会话');
        process.exit(1);
      }

      const session: Session = {
        id: generateId(),
        name,
        startTime: new Date().toISOString(),
        operations: [],
        recordedRequests: [],
        active: true,
      };

      await saveActiveSession(session, cwd);

      logger.raw('');
      logger.success(`联调会话已启动: ${chalk.yellow(name)}`);
      logger.raw('');
      logger.raw(chalk.cyan('💡 会话已开始记录以下操作:'));
      logger.raw(`  ${chalk.gray('-')} route add/delete/use`);
      logger.raw(`  ${chalk.gray('-')} case add/delete/update/default`);
      logger.raw(`  ${chalk.gray('-')} debug 试算`);
      logger.raw(`  ${chalk.gray('-')} serve 请求（需开启录制）`);
      logger.raw(`  ${chalk.gray('-')} record list/show/to-case`);
      logger.raw('');
      logger.info(`使用 "mock session report" 导出会话报告`);
      logger.info(`使用 "mock session end" 结束会话`);
      logger.raw('');
    });
}

function createEndCommand(): Command {
  return new Command('end')
    .description('结束当前联调会话')
    .option('-y, --yes', '跳过确认', false)
    .action(async (options) => {
      const cwd = process.cwd();
      const configManager = new ConfigManager();
      await configManager.ensureProject();

      const session = await getActiveSession(cwd);
      if (!session) {
        logger.error('当前没有活跃的会话');
        logger.info('使用 "mock session start <name>" 启动会话');
        process.exit(1);
      }

      if (!options.yes) {
        const inquirer = require('inquirer');
        const answer = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `确认结束会话 "${session.name}"?`,
            default: true,
          },
        ]);
        if (!answer.confirm) {
          logger.info('已取消');
          return;
        }
      }

      session.active = false;
      session.endTime = new Date().toISOString();

      const sessionDir = getSessionDir(cwd);
      const archivePath = path.join(sessionDir, `${session.name}_${session.id}.json`);
      await fs.writeJson(archivePath, session, { spaces: 2 });
      await fs.remove(getActiveSessionPath(cwd));

      logger.raw('');
      logger.success(`会话已结束: ${chalk.yellow(session.name)}`);
      logger.raw('');
      logger.raw(chalk.cyan('📊 会话统计:'));
      logger.raw(`  ${chalk.gray('操作记录:')} ${session.operations.length} 条`);
      logger.raw(`  ${chalk.gray('接口请求:')} ${session.recordedRequests.length} 条`);
      logger.raw(`  ${chalk.gray('持续时间:')} ${Math.floor((new Date(session.endTime!).getTime() - new Date(session.startTime).getTime()) / 1000)} 秒`);
      logger.raw('');
      logger.info(`会话已保存到: ${chalk.cyan(archivePath)}`);
      logger.info(`使用 "mock session report" 生成 Markdown 报告`);
      logger.raw('');
    });
}

function createReportCommand(): Command {
  return new Command('report')
    .description('生成联调会话的 Markdown 报告')
    .option('-o, --output <file>', '输出文件路径', 'session-report.md')
    .option('--all', '包含所有历史会话', false)
    .action(async (options) => {
      const cwd = process.cwd();
      const configManager = new ConfigManager();
      await configManager.ensureProject();
      const config = configManager.getConfig();

      let session: Session | null = null;

      if (options.all) {
        logger.error('--all 选项暂未实现，将生成当前活跃会话的报告');
      }

      session = await getActiveSession(cwd);
      if (!session) {
        const sessionDir = getSessionDir(cwd);
        if (await fs.pathExists(sessionDir)) {
          const files = await fs.readdir(sessionDir);
          const sessionFiles = files.filter(f => f.endsWith('.json') && f !== 'active.json');
          if (sessionFiles.length > 0) {
            const latestFile = sessionFiles.sort().reverse()[0];
            session = await fs.readJson(path.join(sessionDir, latestFile)) as Session;
            logger.info(`使用最近的会话: ${chalk.yellow(session.name)}`);
          }
        }
      }

      if (!session) {
        logger.error('没有找到会话数据');
        logger.info('使用 "mock session start <name>" 启动新会话');
        process.exit(1);
      }

      const report = generateMarkdownReport(session, config);
      const outputPath = path.resolve(options.output);
      await fs.writeFile(outputPath, report);

      logger.raw('');
      logger.success(`会话报告已生成: ${chalk.cyan(outputPath)}`);
      logger.raw('');
      logger.raw(chalk.cyan('📋 报告内容:'));
      logger.raw(`  ${chalk.gray('-')} 会话基本信息`);
      logger.raw(`  ${chalk.gray('-')} 操作历史记录`);
      logger.raw(`  ${chalk.gray('-')} 接口访问统计`);
      logger.raw(`  ${chalk.gray('-')} 场景命中分析`);
      logger.raw(`  ${chalk.gray('-')} 未命中匹配原因`);
      logger.raw(`  ${chalk.gray('-')} 推荐沉淀的 Case`);
      logger.raw('');
    });
}

function generateMarkdownReport(session: Session, config: { baseUrl: string; port: number }): string {
  const lines: string[] = [];
  const duration = session.endTime
    ? Math.floor((new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 1000)
    : Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000);

  lines.push(`# 联调会话报告: ${session.name}`);
  lines.push('');
  lines.push(`> 生成时间: ${new Date().toLocaleString()}`);
  lines.push('');
  lines.push('## 会话信息');
  lines.push('');
  lines.push('| 项目 | 内容 |');
  lines.push('|------|------|');
  lines.push(`| 会话名称 | ${session.name} |`);
  lines.push(`| 开始时间 | ${new Date(session.startTime).toLocaleString()} |`);
  lines.push(`| 结束时间 | ${session.endTime ? new Date(session.endTime).toLocaleString() : '进行中'} |`);
  lines.push(`| 持续时间 | ${Math.floor(duration / 60)}分${duration % 60}秒 |`);
  lines.push(`| 操作记录 | ${session.operations.length} 条 |`);
  lines.push(`| 接口请求 | ${session.recordedRequests.length} 条 |`);
  lines.push(`| Base URL | ${config.baseUrl} |`);
  lines.push('');

  if (session.operations.length > 0) {
    lines.push('## 操作历史');
    lines.push('');
    lines.push('| 时间 | 类型 | 命令 | 详情 |');
    lines.push('|------|------|------|------|');

    for (const op of session.operations) {
      const time = new Date(op.timestamp).toLocaleTimeString();
      const type = op.type.replace(/_/g, ' ');
      const details = typeof op.details === 'object' ? JSON.stringify(op.details) : String(op.details);
      lines.push(`| ${time} | ${type} | \`${op.command}\` | ${details.slice(0, 50)}${details.length > 50 ? '...' : ''} |`);
    }
    lines.push('');

    const debugOps = session.operations.filter(op => op.type === 'debug' && (op.details as any).allCaseResults);
    if (debugOps.length > 0) {
      lines.push('## 场景匹配详细分析');
      lines.push('');

      for (const op of debugOps) {
        const details = op.details as any;
        const time = new Date(op.timestamp).toLocaleString();

        lines.push(`### ${details.method} ${details.fullPath}`);
        lines.push('');
        lines.push(`> **时间**: ${time}`);
        if (Object.keys(details.query || {}).length > 0) {
          lines.push(`> **Query**: \`${JSON.stringify(details.query)}\``);
        }
        if (Object.keys(details.body || {}).length > 0) {
          lines.push(`> **Body**: \`${JSON.stringify(details.body)}\``);
        }
        lines.push('');
        lines.push('| 场景 | 命中 | 原因 | 详细条件 |');
        lines.push('|------|------|------|----------|');

        for (const cr of details.allCaseResults) {
          const status = cr.matched ? '✅' : '❌';
          const caseName = cr.caseName;
          const reason = cr.overallReason;

          let detailStr = '-';
          const conditionDetails: string[] = [];

          if (cr.queryCheck && !cr.queryCheck.passed) {
            for (const d of cr.queryCheck.details) {
              if (!d.passed) {
                conditionDetails.push(`query: ${d.condition.name} ${d.reason}`);
              }
            }
          }
          if (cr.bodyCheck && !cr.bodyCheck.passed) {
            for (const d of cr.bodyCheck.details) {
              if (!d.passed) {
                conditionDetails.push(`body: ${d.condition.name} ${d.reason}`);
              }
            }
          }
          if (cr.headersCheck && !cr.headersCheck.passed) {
            for (const d of cr.headersCheck.details) {
              if (!d.passed) {
                conditionDetails.push(`headers: ${d.condition.name} ${d.reason}`);
              }
            }
          }

          if (conditionDetails.length > 0) {
            detailStr = conditionDetails.join('<br>');
          }

          lines.push(`| ${caseName} | ${status} | ${reason} | ${detailStr} |`);
        }
        lines.push('');
        lines.push(`> **最终命中**: ${details.selectedCase} - ${details.selectionReason}`);
        lines.push('');
      }
    }
  }

  if (session.recordedRequests.length > 0) {
    const urlStats = new Map<string, { count: number; success: number; cases: Set<string> }>();
    const failedMatches: Array<{ request: RecordedRequest; reason: string }> = [];
    const recommendedCases: Array<{ request: RecordedRequest; reason: string }> = [];

    for (const req of session.recordedRequests) {
      const key = `${req.method} ${req.path}`;
      if (!urlStats.has(key)) {
        urlStats.set(key, { count: 0, success: 0, cases: new Set() });
      }
      const stat = urlStats.get(key)!;
      stat.count++;
      if (req.response.statusCode < 400) stat.success++;
      stat.cases.add(req.response.caseName);

      if (req.response.selectionReason.includes('不匹配')) {
        failedMatches.push({ request: req, reason: req.response.selectionReason });
      }

      if (req.response.statusCode < 400 && !req.response.caseName.includes('default')) {
        recommendedCases.push({ request: req, reason: '高频访问，响应稳定' });
      }
    }

    lines.push('## 接口访问统计');
    lines.push('');
    lines.push('| 接口 | 访问次数 | 成功次数 | 命中场景 |');
    lines.push('|------|----------|----------|----------|');

    for (const [url, stat] of urlStats.entries()) {
      const fullPath = (config.baseUrl + url.split(' ')[1]).replace(/\/+/g, '/');
      lines.push(`| \`${url}\` (${fullPath}) | ${stat.count} | ${stat.success} | ${Array.from(stat.cases).join(', ')} |`);
    }
    lines.push('');

    if (failedMatches.length > 0) {
      lines.push('## 未命中匹配原因');
      lines.push('');

      for (const item of failedMatches) {
        const req = item.request;
        lines.push(`### ${req.method} ${req.fullUrl}`);
        lines.push('');
        lines.push(`- **时间**: ${new Date(req.timestamp).toLocaleString()}`);
        lines.push(`- **状态码**: ${req.response.statusCode}`);
        lines.push(`- **命中场景**: ${req.response.caseName}`);
        lines.push(`- **原因**: ${item.reason}`);
        if (Object.keys(req.query).length > 0) {
          lines.push(`- **Query**: \`${JSON.stringify(req.query)}\``);
        }
        if (req.body && Object.keys(req.body).length > 0) {
          lines.push(`- **Body**: \`${JSON.stringify(req.body)}\``);
        }
        lines.push('');
      }
    }

    if (recommendedCases.length > 0) {
      lines.push('## 推荐沉淀的 Case');
      lines.push('');
      lines.push('> 以下请求响应稳定，建议沉淀为正式 Case:');
      lines.push('');

      const uniqueRecommendations = new Map<string, typeof recommendedCases[0]>();
      for (const item of recommendedCases) {
        const key = `${item.request.method} ${item.request.path}`;
        if (!uniqueRecommendations.has(key)) {
          uniqueRecommendations.set(key, item);
        }
      }

      for (const [key, item] of uniqueRecommendations.entries()) {
        const req = item.request;
        lines.push(`### ${req.method} ${req.path}`);
        lines.push('');
        lines.push(`- **推荐原因**: ${item.reason}`);
        lines.push(`- **当前场景**: ${req.response.caseName}`);
        lines.push(`- **状态码**: ${req.response.statusCode}`);
        if (Object.keys(req.query).length > 0) {
          lines.push(`- **匹配条件 (Query)**: ${Object.entries(req.query).map(([k, v]) => `${k}=${v}`).join(', ')}`);
        }
        lines.push(`- **响应体**: `);
        lines.push('```json');
        lines.push(JSON.stringify(req.response.body, null, 2));
        lines.push('```');
        lines.push('');
        lines.push(`> 转换命令: \`mock record to-case ${req.id} ${req.method} ${req.path} --name <caseName>\``);
        lines.push('');
      }
    }

    lines.push('## 录制记录详情');
    lines.push('');
    lines.push('| 时间 | 方法 | 路径 | 状态码 | 场景 | 耗时 |');
    lines.push('|------|------|------|--------|------|------|');

    for (const req of session.recordedRequests) {
      const time = new Date(req.timestamp).toLocaleTimeString();
      lines.push(`| ${time} | ${req.method} | ${req.path} | ${req.response.statusCode} | ${req.response.caseName} | ${req.duration}ms |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`> 报告由 Mock API CLI 自动生成`);

  return lines.join('\n');
}

export function createSessionCommand(): Command {
  const command = new Command('session')
    .description('联调会话管理 - 记录操作并生成对齐报告');

  command.addCommand(createStartCommand());
  command.addCommand(createEndCommand());
  command.addCommand(createReportCommand());

  return command;
}
