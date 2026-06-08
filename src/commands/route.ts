import { Command } from 'commander';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import { ConfigManager } from '../utils/config';
import { logger } from '../utils/logger';
import { HttpMethod, Route } from '../types';

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

      const exists = await configManager.routeExists(upperMethod, path);
      if (exists && !options.force) {
        logger.error(`路由已存在: ${upperMethod} ${path}`);
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
        path,
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
      logger.success(`已添加路由: ${chalk.green(upperMethod)} ${chalk.cyan(path)}`);
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

      const data = filtered.map(route => [
        chalk.green(route.method),
        chalk.cyan(route.path),
        route.description || '-',
        route.cases.length.toString(),
        route.activeCase ? chalk.yellow(route.activeCase) : '-',
        route.tags ? route.tags.join(', ') : '-',
      ]);

      logger.table(
        data,
        ['方法', '路径', '描述', '场景数', '当前场景', '标签']
      );
      logger.raw(`\n共 ${chalk.bold(filtered.length)} 个路由`);
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

      logger.raw(chalk.cyan(`\n=== ${route.method} ${route.path} ===`));
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
    .description('设置路由当前使用的响应场景')
    .arguments('<method> <path> <caseName>')
    .action(async (method: string, path: string, caseName: string) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();

      const upperMethod = method.toUpperCase();
      const route = await configManager.loadRoute(upperMethod, path);

      if (!route) {
        logger.error(`路由不存在: ${upperMethod} ${path}`);
        process.exit(1);
      }

      const caseExists = route.cases.some(c => c.name === caseName);
      if (!caseExists) {
        logger.error(`场景不存在: ${caseName}`);
        logger.info(`可用场景: ${route.cases.map(c => c.name).join(', ')}`);
        process.exit(1);
      }

      route.activeCase = caseName;
      route.updatedAt = new Date().toISOString();
      await configManager.saveRoute(route);

      logger.success(`已设置 ${chalk.green(upperMethod)} ${chalk.cyan(path)} 使用场景: ${chalk.yellow(caseName)}`);
    });
}
