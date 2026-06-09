import { Command } from 'commander';
import chalk from 'chalk';
import { ConfigManager } from '../utils/config';
import { logger } from '../utils/logger';
import { selectResponseCase, CaseMatchResult, ConditionCheckResult } from '../utils/condition';
import { Route } from '../types';
import { recordOperation } from './session';

export function createDebugCommand(): Command {
  const command = new Command('debug');

  command
    .description('场景调试面板 - 测试参数匹配和查看命中逻辑')
    .arguments('<method> <path>')
    .option('-q, --query <query>', 'query 参数，JSON 字符串或 key=value 格式，可多次指定', (v, p) => [...p, v], [] as string[])
    .option('-b, --body <body>', 'body 参数，JSON 字符串或 key=value 格式，可多次指定', (v, p) => [...p, v], [] as string[])
    .option('-H, --header <header>', 'header 参数，key=value 格式，可多次指定', (v, p) => [...p, v], [] as string[])
    .option('--override-case <caseName>', '强制使用指定场景')
    .option('--full', '显示完整响应体', false)
    .action(async (method: string, path: string, options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();

      const upperMethod = method.toUpperCase();
      const route = await configManager.loadRoute(upperMethod, path);

      if (!route) {
        logger.error(`路由不存在: ${upperMethod} ${path}`);
        const allRoutes = await configManager.loadAllRoutes();
        if (allRoutes.length > 0) {
          logger.info('可用路由:');
          for (const r of allRoutes) {
            logger.raw(`  ${chalk.green(r.method)} ${chalk.cyan(r.path)}`);
          }
        }
        process.exit(1);
      }

      const query = parseParams(options.query);
      const body = parseParams(options.body);
      const headers = parseParams(options.header);

      const fullPath = configManager.getFullPath(path);
      const config = configManager.getConfig();
      const fullUrl = `http://localhost:${config.port}${fullPath}`;

      logger.raw('');
      logger.raw(chalk.cyan('='.repeat(80)));
      logger.raw(chalk.cyan.bold(`  调试面板: ${upperMethod} ${path}`));
      logger.raw(chalk.cyan('='.repeat(80)));
      logger.raw('');
      logger.raw(`${chalk.gray('完整路径:')} ${chalk.cyan(fullPath)}`);
      logger.raw(`${chalk.gray('访问地址:')} ${chalk.cyan(fullUrl)}`);
      logger.raw('');

      logger.raw(chalk.bold('📋 输入参数:'));
      if (Object.keys(query).length > 0) {
        logger.raw(`  ${chalk.magenta('query:')} ${JSON.stringify(query)}`);
      }
      if (Object.keys(body).length > 0) {
        logger.raw(`  ${chalk.magenta('body:')} ${JSON.stringify(body)}`);
      }
      if (Object.keys(headers).length > 0) {
        logger.raw(`  ${chalk.magenta('headers:')} ${JSON.stringify(headers)}`);
      }
      if (Object.keys(query).length === 0 && Object.keys(body).length === 0 && Object.keys(headers).length === 0) {
        logger.raw(`  ${chalk.gray('(无参数)')}`);
      }
      logger.raw('');

      logger.raw(chalk.bold('🎯 场景匹配分析:'));
      logger.raw('');

      const result = selectResponseCase(
        { cases: route.cases, activeCase: route.activeCase },
        { query, body, headers },
        options.overrideCase
      );

      for (let i = 0; i < route.cases.length; i++) {
        const caseItem = route.cases[i];
        const caseResult = result.allCaseResults[i];

        const isSelected = result.selectedCase.name === caseItem.name;
        const prefix = isSelected ? chalk.green('▶ ') : '  ';
        const statusIcon = caseResult?.matched ? chalk.green('✓') : chalk.red('✗');
        const defaultTag = caseItem.default ? chalk.blue(' [默认]') : '';
        const activeTag = route.activeCase === caseItem.name ? chalk.yellow(' [当前]') : '';
        const selectedTag = isSelected ? chalk.bgGreen.white(' [命中] ') : '';

        logger.raw(`${prefix}${statusIcon} ${chalk.bold(caseItem.name)}${defaultTag}${activeTag}${selectedTag}`);
        logger.raw(`   ${chalk.gray(`状态码: ${caseItem.statusCode} | 延迟: ${caseItem.delay || 0}ms`)}`);

        if (caseItem.description) {
          logger.raw(`   ${chalk.gray(caseItem.description)}`);
        }

        if (caseResult) {
          logger.raw(`   ${chalk.gray('匹配结果:')} ${caseResult.matched ? chalk.green(caseResult.overallReason) : chalk.red(caseResult.overallReason)}`);

          if (caseResult.queryCheck?.details.length) {
            logger.raw(`   ${chalk.gray('query 条件:')}`);
            printConditionDetails(caseResult.queryCheck);
          }
          if (caseResult.bodyCheck?.details.length) {
            logger.raw(`   ${chalk.gray('body 条件:')}`);
            printConditionDetails(caseResult.bodyCheck);
          }
          if (caseResult.headersCheck?.details.length) {
            logger.raw(`   ${chalk.gray('headers 条件:')}`);
            printConditionDetails(caseResult.headersCheck);
          }
        }

        if (isSelected) {
          logger.raw('');
          logger.raw(chalk.bold('📤 最终响应:'));
          logger.raw(`   ${chalk.magenta('状态码:')} ${result.selectedCase.statusCode}`);
          logger.raw(`   ${chalk.magenta('延迟:')} ${result.selectedCase.delay || 0}ms`);
          if (result.selectedCase.headers && Object.keys(result.selectedCase.headers).length > 0) {
            logger.raw(`   ${chalk.magenta('响应头:')} ${JSON.stringify(result.selectedCase.headers)}`);
          }
          logger.raw(`   ${chalk.magenta('命中原因:')} ${chalk.green(result.selectionReason)}`);
          logger.raw(`   ${chalk.magenta('响应体:')}`);

          const bodyStr = typeof result.selectedCase.body === 'string'
            ? result.selectedCase.body
            : JSON.stringify(result.selectedCase.body, null, 2);

          const lines = bodyStr.split('\n');
          if (!options.full && lines.length > 20) {
            logger.raw(`   ${lines.slice(0, 20).join('\n   ')}`);
            logger.raw(`   ${chalk.gray(`... (共 ${lines.length} 行, 使用 --full 查看完整内容)`)}`);
          } else {
            logger.raw(`   ${lines.join('\n   ')}`);
          }
        }

        logger.raw('');
      }

      logger.raw(chalk.cyan('='.repeat(80)));
      logger.raw(chalk.bold('💡 命中逻辑优先级:'));
      logger.raw(`  ${chalk.gray('1.')} 全局覆盖场景 (--override-case)`);
      logger.raw(`  ${chalk.gray('2.')} 参数条件匹配 (按 case 顺序)`);
      logger.raw(`  ${chalk.gray('3.')} 当前激活场景 (activeCase)`);
      logger.raw(`  ${chalk.gray('4.')} 默认场景 (default: true)`);
      logger.raw(`  ${chalk.gray('5.')} 第一个场景`);
      logger.raw(chalk.cyan('='.repeat(80)));

      recordOperation('debug', process.argv.join(' '), {
        method: upperMethod,
        path,
        fullPath: configManager.getFullPath(path),
        query,
        body,
        headers,
        selectedCase: result.selectedCase.name,
        selectionReason: result.selectionReason,
        allCaseResults: result.allCaseResults.map((cr: CaseMatchResult) => ({
          caseName: cr.caseName,
          matched: cr.matched,
          overallReason: cr.overallReason,
          queryCheck: cr.queryCheck ? { passed: cr.queryCheck.passed, details: cr.queryCheck.details } : undefined,
          bodyCheck: cr.bodyCheck ? { passed: cr.bodyCheck.passed, details: cr.bodyCheck.details } : undefined,
          headersCheck: cr.headersCheck ? { passed: cr.headersCheck.passed, details: cr.headersCheck.details } : undefined,
        })),
      });
    });

  return command;
}

function parseParams(params: string[]): Record<string, any> {
  const result: Record<string, any> = {};

  for (const param of params) {
    if (param.startsWith('{') || param.startsWith('[')) {
      try {
        const parsed = JSON.parse(param);
        Object.assign(result, parsed);
      } catch {
        logger.warning(`无法解析 JSON: ${param}`);
      }
    } else {
      const eqIndex = param.indexOf('=');
      if (eqIndex > 0) {
        const key = param.slice(0, eqIndex).trim();
        let value: any = param.slice(eqIndex + 1).trim();
        if (!isNaN(Number(value))) {
          value = Number(value);
        } else if (value === 'true') {
          value = true;
        } else if (value === 'false') {
          value = false;
        } else if (value === 'null') {
          value = null;
        }
        result[key] = value;
      }
    }
  }

  return result;
}

function printConditionDetails(checkResult: ConditionCheckResult): void {
  for (const detail of checkResult.details) {
    const status = detail.passed ? chalk.green('✓') : chalk.red('✗');
    const valueStr = detail.actualValue === undefined
      ? chalk.gray('undefined')
      : JSON.stringify(detail.actualValue);
    logger.raw(`     ${status} ${chalk.bold(detail.condition.name)} = ${valueStr} → ${detail.reason}`);
  }
}
