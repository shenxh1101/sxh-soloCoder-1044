import { Command } from 'commander';
import chalk from 'chalk';
import * as inquirer from 'inquirer';
import { ConfigManager } from '../utils/config';
import { logger } from '../utils/logger';
import { Route, HttpMethod } from '../types';
import { recordOperation } from './session';
import * as yaml from 'js-yaml';

export function createRouteCommand(): Command {
  const command = new Command('route');

  command
    .description('管理接口路由配置')
    .addCommand(createAddCommand())
    .addCommand(createListCommand())
    .addCommand(createDeleteCommand())
    .addCommand(createShowCommand())
    .addCommand(createValidateCommand())
    .addCommand(createUseCommand());

  return command;
}

function createAddCommand(): Command {
  return new Command('add')
    .description('新增接口路由')
    .arguments('<method> <path>')
    .option('-d, --description <desc>', '接口描述')
    .option('-t, --tags <tags>', '标签，逗号分隔', '')
    .option('-s, --status-code <code>', '默认状态码', '200')
    .option('-b, --body <json>', '默认响应体，JSON 字符串', '{}')
    .option('--delay <ms>', '响应延迟（毫秒）', '0')
    .option('-f, --force', '覆盖已存在的路由', false)
    .action(async (method: string, path: string, options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();

      const upperMethod = method.toUpperCase() as HttpMethod;
      if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(upperMethod)) {
        logger.error(`不支持的 HTTP 方法: ${method}`);
        process.exit(1);
      }

      if (!path.startsWith('/')) {
        logger.error('路径必须以 / 开头');
        process.exit(1);
      }

      const config = configManager.getConfig();
      const baseUrl = config.baseUrl;
      const normalizedPath = configManager.normalizePath(path);

      if (path !== normalizedPath) {
        logger.warning(`路径已自动规范化: ${chalk.yellow(path)} → ${chalk.green(normalizedPath)}`);
        logger.info(`路径相对于 baseUrl (${baseUrl})，无需包含 baseUrl 前缀`);
      }

      const exists = await configManager.routeExists(upperMethod, normalizedPath);
      if (exists && !options.force) {
        logger.error(`路由已存在: ${upperMethod} ${normalizedPath}`);
        logger.info('使用 -f 或 --force 选项覆盖');
        process.exit(1);
      }

      let body: any = {};
      if (options.body) {
        try {
          body = JSON.parse(options.body);
        } catch {
          body = options.body;
        }
      }

      const now = new Date().toISOString();
      const route: Route = {
        path: normalizedPath,
        method: upperMethod,
        description: options.description,
        tags: options.tags ? options.tags.split(',').map((t: string) => t.trim()) : undefined,
        createdAt: now,
        updatedAt: now,
        cases: [
          {
            name: 'default',
            description: '默认响应',
            statusCode: parseInt(options.statusCode, 10),
            delay: parseInt(options.delay, 10),
            body,
            default: true,
          },
        ],
        activeCase: 'default',
      };

      await configManager.saveRoute(route);

      const fullPath = configManager.getFullPath(normalizedPath);
      const fullUrl = `http://localhost:${config.port}${fullPath}`;

      logger.success(`已添加路由: ${chalk.green(upperMethod)} ${chalk.cyan(normalizedPath)}`);
      logger.raw(`  ${chalk.gray('完整路径:')} ${chalk.cyan(fullPath)}`);
      logger.raw(`  ${chalk.gray('访问地址:')} ${chalk.cyan(fullUrl)}`);
      logger.raw(`  ${chalk.gray('Base URL:')} ${baseUrl}`);
      logger.raw(`  ${chalk.gray('说明:')} 路由路径已自动去除 baseUrl 前缀，避免重复拼接`);

      recordOperation('route_add', process.argv.join(' '), {
        method: upperMethod,
        path: normalizedPath,
        fullPath,
        description: options.description,
      });
    });
}

function createListCommand(): Command {
  return new Command('list')
    .description('列出所有已定义的路由')
    .option('-t, --tag <tag>', '按标签筛选')
    .option('-m, --method <method>', '按方法筛选')
    .action(async (options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();
      const config = configManager.getConfig();

      const routes = await configManager.loadAllRoutes();

      if (routes.length === 0) {
        logger.info('暂无路由配置');
        logger.info('使用 mock route add <method> <path> 添加路由');
        return;
      }

      let filtered = routes;
      if (options.tag) {
        filtered = filtered.filter(r => r.tags?.includes(options.tag));
      }
      if (options.method) {
        filtered = filtered.filter(r => r.method === options.method.toUpperCase());
      }

      const data = filtered.map(route => {
        const fullPath = configManager.getFullPath(route.path);
        return [
          chalk.green(route.method),
          chalk.cyan(route.path),
          chalk.gray(fullPath),
          route.description || '-',
          route.cases.length.toString(),
          route.activeCase ? chalk.yellow(route.activeCase) : '-',
          route.tags ? route.tags.join(', ') : '-',
        ];
      });

      logger.table(
        data,
        ['方法', '路径', '完整路径', '描述', '场景数', '当前场景', '标签']
      );
      logger.raw(`\n共 ${chalk.bold(filtered.length)} 个路由`);
      logger.raw(`${chalk.gray(`Base URL: ${config.baseUrl}`)}`);
    });
}

function createDeleteCommand(): Command {
  return new Command('delete')
    .description('删除指定路由')
    .arguments('<method> <path>')
    .option('-y, --yes', '跳过确认', false)
    .action(async (method: string, path: string, options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();

      const upperMethod = method.toUpperCase();
      const exists = await configManager.routeExists(upperMethod, path);

      if (!exists) {
        logger.error(`路由不存在: ${upperMethod} ${path}`);
        process.exit(1);
      }

      if (!options.yes) {
        const inquirer = require('inquirer');
        const answer = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `确认删除路由 ${upperMethod} ${path}?`,
            default: false,
          },
        ]);
        if (!answer.confirm) {
          logger.info('已取消删除');
          return;
        }
      }

      await configManager.deleteRoute(upperMethod, path);
      logger.success(`已删除路由: ${chalk.green(upperMethod)} ${chalk.cyan(path)}`);

      recordOperation('route_delete', process.argv.join(' '), {
        method: upperMethod,
        path,
      });
    });
}

function createShowCommand(): Command {
  return new Command('show')
    .description('显示路由详细配置')
    .arguments('<method> <path>')
    .action(async (method: string, path: string) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();

      const upperMethod = method.toUpperCase();
      const route = await configManager.loadRoute(upperMethod, path);

      if (!route) {
        logger.error(`路由不存在: ${upperMethod} ${path}`);
        process.exit(1);
      }

      const fullPath = configManager.getFullPath(route.path);
      const config = configManager.getConfig();
      const fullUrl = `http://localhost:${config.port}${fullPath}`;

      logger.raw(chalk.cyan(`\n=== ${route.method} ${route.path} ===`));
      logger.raw(chalk.gray(`完整路径: ${fullPath}`));
      logger.raw(chalk.gray(`访问地址: ${fullUrl}`));
      if (route.description) {
        logger.raw(chalk.gray(`描述: ${route.description}`));
      }
      if (route.tags?.length) {
        logger.raw(chalk.gray(`标签: ${route.tags.join(', ')}`));
      }
      logger.raw(chalk.gray(`创建时间: ${route.createdAt}`));
      logger.raw(chalk.gray(`更新时间: ${route.updatedAt}`));
      if (route.activeCase) {
        logger.raw(chalk.yellow(`当前场景: ${route.activeCase}`));
      }
      const defaultCase = route.cases.find(c => c.default);
      if (defaultCase) {
        logger.raw(chalk.blue(`默认场景: ${defaultCase.name}`));
      }
      logger.raw('');

      for (const caseItem of route.cases) {
        const isActive = route.activeCase === caseItem.name;
        const isDefault = caseItem.default;
        const prefix = isActive ? chalk.green('▶ ') : '  ';
        const defaultTag = isDefault ? chalk.blue('[默认]') : '';
        const activeTag = isActive ? chalk.yellow('[当前]') : '';

        logger.raw(`${prefix}${chalk.bold(caseItem.name)} ${defaultTag} ${activeTag}`);
        if (caseItem.description) {
          logger.raw(`   ${chalk.gray(caseItem.description)}`);
        }
        logger.raw(`   状态码: ${chalk.magenta(caseItem.statusCode)} | 延迟: ${chalk.magenta(caseItem.delay || 0)}ms`);
        if (caseItem.conditions) {
          logger.raw(`   条件: ${JSON.stringify(caseItem.conditions)}`);
        }
        logger.raw(`   响应体:`);
        const bodyStr = typeof caseItem.body === 'string'
          ? caseItem.body
          : JSON.stringify(caseItem.body, null, 2);
        logger.raw(`   ${bodyStr.split('\n').join('\n   ')}`);
        logger.raw('');
      }

      logger.raw(chalk.cyan('--- 原始 YAML ---'));
      logger.raw(yaml.dump(route, { indent: 2 }));
    });
}

function createValidateCommand(): Command {
  return new Command('validate')
    .description('批量校验所有路由配置')
    .action(async () => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();

      const results = await configManager.validateRoutes();

      if (results.length === 0) {
        logger.info('暂无路由配置');
        return;
      }

      let errorCount = 0;
      let warningCount = 0;

      for (const result of results) {
        const status = result.valid ? chalk.green('✓') : chalk.red('✗');
        logger.raw(`${status} ${chalk.bold(result.routePath!)}`);

        for (const error of result.errors) {
          logger.raw(`   ${chalk.red('错误:')} ${error}`);
          errorCount++;
        }
        for (const warning of result.warnings) {
          logger.raw(`   ${chalk.yellow('警告:')} ${warning}`);
          warningCount++;
        }
      }

      logger.raw('');
      if (errorCount > 0) {
        logger.error(`校验完成: ${errorCount} 个错误, ${warningCount} 个警告`);
        process.exit(1);
      } else if (warningCount > 0) {
        logger.warning(`校验完成: 0 个错误, ${warningCount} 个警告`);
      } else {
        logger.success(`校验完成: 全部 ${results.length} 个路由配置正确`);
      }
    });
}

function createUseCommand(): Command {
  return new Command('use')
    .description('设置路由当前使用的响应场景（无参数匹配时优先使用）')
    .arguments('<method> <path> <caseName>')
    .option('--also-default', '同时设为默认场景', false)
    .action(async (method: string, path: string, caseName: string, options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();

      const upperMethod = method.toUpperCase();
      const route = await configManager.loadRoute(upperMethod, path);

      if (!route) {
        logger.error(`路由不存在: ${upperMethod} ${path}`);
        process.exit(1);
      }

      const caseItem = route.cases.find(c => c.name === caseName);
      if (!caseItem) {
        logger.error(`场景不存在: ${caseName}`);
        logger.info(`可用场景: ${route.cases.map(c => c.name).join(', ')}`);
        process.exit(1);
      }

      const oldActive = route.activeCase;
      route.activeCase = caseName;

      if (options.alsoDefault) {
        route.cases.forEach(c => { c.default = false; });
        caseItem.default = true;
      }

      route.updatedAt = new Date().toISOString();
      await configManager.saveRoute(route);

      logger.raw('');
      logger.success(`已设置当前场景: ${chalk.yellow(caseName)}`);
      logger.raw(`  ${chalk.green(upperMethod)} ${chalk.cyan(path)}`);

      if (oldActive !== caseName) {
        logger.info(`之前的当前场景: ${oldActive ? chalk.yellow(oldActive) : chalk.gray('(无)')}`);
      }

      if (options.alsoDefault) {
        logger.success(`已同步设置为默认场景: ${chalk.yellow(caseName)}`);
      }

      logger.raw('');
      logger.raw(chalk.cyan('💡 场景说明:'));
      logger.raw(`  ${chalk.yellow('[当前场景]')} 无参数匹配时优先使用，优先级高于默认场景`);
      logger.raw(`  ${chalk.blue('[默认场景]')} 无参数匹配且无当前场景时使用`);
      logger.raw(`  ${chalk.green('[条件匹配]')} 按参数匹配，优先级最高`);
      logger.raw('');

      recordOperation('route_use', process.argv.join(' '), {
        method: upperMethod,
        path,
        caseName,
        oldActive,
        alsoDefault: options.alsoDefault,
      });
    });
}
