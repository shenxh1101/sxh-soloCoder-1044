import { Command } from 'commander';
import chalk from 'chalk';
import { ConfigManager } from '../utils/config';
import { logger } from '../utils/logger';
import { ResponseCase, ParameterCondition } from '../types';

export function createCaseCommand(): Command {
  const command = new Command('case');

  command
    .description('管理接口的多场景响应配置')
    .addCommand(createAddCommand())
    .addCommand(createListCommand())
    .addCommand(createDeleteCommand())
    .addCommand(createUpdateCommand())
    .addCommand(createDefaultCommand());

  return command;
}

function createAddCommand(): Command {
  return new Command('add')
    .description('为接口新增响应场景')
    .arguments('<method> <path> <caseName>')
    .option('-d, --description <desc>', '场景描述')
    .option('-s, --status-code <code>', '状态码', '200')
    .option('-b, --body <json>', '响应体，JSON 字符串', '{}')
    .option('--delay <ms>', '响应延迟（毫秒）', '0')
    .option('--header <header>', '响应头，可多次指定', (v, p) => [...p, v], [] as string[])
    .option('--default', '设为默认场景', false)
    .option('--query-condition <condition>', 'query 参数条件，支持: name=value, name>value, name>=value, name<value, name<=value, name!=value, name=~value, name=/pattern/, name?, name!?', (v, p) => [...p, v], [] as string[])
    .option('--body-condition <condition>', 'body 参数条件，格式同上', (v, p) => [...p, v], [] as string[])
    .option('--header-condition <condition>', 'header 条件，格式同上（大小写不敏感）', (v, p) => [...p, v], [] as string[])
    .option('-f, --force', '覆盖已存在的场景', false)
    .action(async (method: string, path: string, caseName: string, options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();

      const upperMethod = method.toUpperCase();
      const route = await configManager.loadRoute(upperMethod, path);

      if (!route) {
        logger.error(`路由不存在: ${upperMethod} ${path}`);
        logger.info('先使用 mock route add 创建路由');
        process.exit(1);
      }

      const existingIndex = route.cases.findIndex(c => c.name === caseName);
      if (existingIndex !== -1 && !options.force) {
        logger.error(`场景已存在: ${caseName}`);
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

      const headers: Record<string, string> = {};
      for (const h of options.header) {
        const [k, v] = h.split('=');
        if (k && v !== undefined) {
          headers[k.trim()] = v.trim();
        }
      }

      const newCase: ResponseCase = {
        name: caseName,
        description: options.description,
        statusCode: parseInt(options.statusCode, 10),
        delay: parseInt(options.delay, 10),
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body,
        default: options.default,
        conditions: parseConditions(options),
      };

      if (options.default) {
        route.cases.forEach(c => { c.default = false; });
      }

      if (existingIndex !== -1) {
        route.cases[existingIndex] = newCase;
      } else {
        route.cases.push(newCase);
      }

      if (route.cases.length === 1) {
        route.cases[0].default = true;
        route.activeCase = caseName;
      }

      if (options.default && !route.activeCase) {
        route.activeCase = caseName;
      }

      route.updatedAt = new Date().toISOString();
      await configManager.saveRoute(route);

      const config = configManager.getConfig();
      const fullPath = (config.baseUrl + path).replace(/\/+/g, '/');

      logger.success(`已${existingIndex !== -1 ? '更新' : '添加'}场景: ${chalk.yellow(caseName)}`);
      logger.raw(`  ${chalk.gray('接口:')} ${chalk.green(upperMethod)} ${chalk.cyan(path)}`);
      logger.raw(`  ${chalk.gray('完整路径:')} ${chalk.cyan(fullPath)}`);
    });
}

function createListCommand(): Command {
  return new Command('list')
    .description('列出接口的所有响应场景')
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

      const config = configManager.getConfig();
      const fullPath = (config.baseUrl + route.path).replace(/\/+/g, '/');

      logger.raw(chalk.cyan(`\n场景列表: ${route.method} ${route.path}`));
      logger.raw(chalk.gray(`完整路径: ${fullPath}`));
      logger.raw('');

      if (route.cases.length === 0) {
        logger.info('暂无场景配置');
        return;
      }

      const data = route.cases.map(c => [
        c.default ? chalk.green('★') : ' ',
        route.activeCase === c.name ? chalk.yellow('▶') : ' ',
        chalk.bold(c.name),
        c.description || '-',
        chalk.magenta(c.statusCode.toString()),
        chalk.magenta((c.delay || 0).toString() + 'ms'),
        c.conditions ? '✓' : '-',
      ]);

      logger.table(
        data,
        ['默认', '当前', '名称', '描述', '状态码', '延迟', '条件']
      );
    });
}

function createDeleteCommand(): Command {
  return new Command('delete')
    .description('删除接口的响应场景')
    .arguments('<method> <path> <caseName>')
    .option('-y, --yes', '跳过确认', false)
    .action(async (method: string, path: string, caseName: string, options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();

      const upperMethod = method.toUpperCase();
      const route = await configManager.loadRoute(upperMethod, path);

      if (!route) {
        logger.error(`路由不存在: ${upperMethod} ${path}`);
        process.exit(1);
      }

      const caseIndex = route.cases.findIndex(c => c.name === caseName);
      if (caseIndex === -1) {
        logger.error(`场景不存在: ${caseName}`);
        process.exit(1);
      }

      if (route.cases.length <= 1) {
        logger.error('至少需要保留一个场景');
        process.exit(1);
      }

      if (!options.yes) {
        const inquirer = require('inquirer');
        const answer = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `确认删除场景 ${caseName}?`,
            default: false,
          },
        ]);
        if (!answer.confirm) {
          logger.info('已取消删除');
          return;
        }
      }

      const wasDefault = route.cases[caseIndex].default;
      const wasActive = route.activeCase === caseName;
      route.cases.splice(caseIndex, 1);

      if (wasDefault) {
        route.cases[0].default = true;
      }
      if (wasActive) {
        route.activeCase = route.cases[0].name;
      }

      route.updatedAt = new Date().toISOString();
      await configManager.saveRoute(route);

      logger.success(`已删除场景: ${chalk.yellow(caseName)}`);
    });
}

function createUpdateCommand(): Command {
  return new Command('update')
    .description('更新接口的响应场景')
    .arguments('<method> <path> <caseName>')
    .option('-d, --description <desc>', '场景描述')
    .option('-s, --status-code <code>', '状态码')
    .option('-b, --body <json>', '响应体，JSON 字符串')
    .option('--delay <ms>', '响应延迟（毫秒）')
    .option('--header <header>', '响应头: name=value', (v, p) => [...p, v], [] as string[])
    .option('--default', '设为默认场景', false)
    .option('--query-condition <condition>', 'query 参数条件: name=value', (v, p) => [...p, v], [] as string[])
    .option('--body-condition <condition>', 'body 参数条件: name=value', (v, p) => [...p, v], [] as string[])
    .option('--header-condition <condition>', 'header 条件: name=value', (v, p) => [...p, v], [] as string[])
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

      if (options.description !== undefined) caseItem.description = options.description;
      if (options.statusCode !== undefined) caseItem.statusCode = parseInt(options.statusCode, 10);
      if (options.delay !== undefined) caseItem.delay = parseInt(options.delay, 10);
      if (options.body !== undefined) {
        try {
          caseItem.body = JSON.parse(options.body);
        } catch {
          caseItem.body = options.body;
        }
      }

      if (options.header.length > 0) {
        const headers: Record<string, string> = caseItem.headers || {};
        for (const h of options.header) {
          const [k, v] = h.split('=');
          if (k && v !== undefined) {
            headers[k.trim()] = v.trim();
          }
        }
        caseItem.headers = headers;
      }

      const newConditions = parseConditions(options);
      if (newConditions) {
        caseItem.conditions = {
          ...caseItem.conditions,
          ...newConditions,
        };
      }

      if (options.default) {
        route.cases.forEach(c => { c.default = false; });
        caseItem.default = true;
      }

      route.updatedAt = new Date().toISOString();
      await configManager.saveRoute(route);

      logger.success(`已更新场景: ${chalk.yellow(caseName)}`);
    });
}

function createDefaultCommand(): Command {
  return new Command('default')
    .description('设置接口的默认响应场景，同时会设为当前场景')
    .arguments('<method> <path> <caseName>')
    .option('--no-activate', '仅设为默认场景，不设为当前场景', false)
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

      route.cases.forEach(c => { c.default = false; });
      caseItem.default = true;

      const oldActive = route.activeCase;
      if (!options.noActivate) {
        route.activeCase = caseName;
      }
      route.updatedAt = new Date().toISOString();

      await configManager.saveRoute(route);

      logger.raw('');
      logger.success(`已设置默认场景: ${chalk.yellow(caseName)}`);
      if (!options.noActivate) {
        if (oldActive !== caseName) {
          logger.success(`已同步设置为当前场景: ${chalk.yellow(caseName)}`);
        } else {
          logger.info(`当前场景保持为: ${chalk.yellow(caseName)}`);
        }
      }
      logger.raw('');
      logger.raw(chalk.cyan('💡 场景说明:'));
      logger.raw(`  ${chalk.blue('[默认场景]')} 没有条件匹配时使用的回退场景`);
      logger.raw(`  ${chalk.yellow('[当前场景]')} 没有条件匹配时优先使用的场景（优先级高于默认场景）`);
      logger.raw(`  ${chalk.green('[条件匹配]')} 按 query/body/header 参数匹配，优先级最高`);
      logger.raw('');
      logger.raw(chalk.cyan('命中顺序:'));
      logger.raw(`  1. 参数条件匹配 → 2. 当前场景(activeCase) → 3. 默认场景(default) → 4. 第一个场景`);
      logger.raw('');
      if (options.noActivate) {
        logger.info(`使用 'mock route use ${upperMethod} ${path} ${caseName}' 单独设置当前场景`);
      }
    });
}

function parseConditions(options: any): ResponseCase['conditions'] | undefined {
  const conditions: ResponseCase['conditions'] = {};
  let hasConditions = false;

  if (options.queryCondition?.length > 0) {
    conditions.query = options.queryCondition.map(parseCondition);
    hasConditions = true;
  }
  if (options.bodyCondition?.length > 0) {
    conditions.body = options.bodyCondition.map(parseCondition);
    hasConditions = true;
  }
  if (options.headerCondition?.length > 0) {
    conditions.headers = options.headerCondition.map(parseCondition);
    hasConditions = true;
  }

  return hasConditions ? conditions : undefined;
}

function parseCondition(condition: string): ParameterCondition {
  const trimmed = condition.trim();

  const existsMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)(\!\?|\?)$/);
  if (existsMatch) {
    return {
      name: existsMatch[1],
      exists: existsMatch[2] === '?'
    };
  }

  const operatorMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)(>=|<=|!=|=~|>|<|=)(.*)$/);
  if (operatorMatch) {
    const [, name, operator, rawValue] = operatorMatch;
    const value = rawValue.trim();
    const result: ParameterCondition = { name };

    const parseValue = (v: string): string | number | boolean => {
      if (v === 'true') return true;
      if (v === 'false') return false;
      if (!isNaN(Number(v)) && v !== '') return Number(v);
      return v;
    };

    switch (operator) {
      case '=':
        if (value.startsWith('/') && value.endsWith('/')) {
          result.matches = value.slice(1, -1);
        } else if (value.includes('*')) {
          result.contains = value.replace(/\*/g, '');
        } else {
          result.value = parseValue(value);
        }
        break;
      case '!=':
        result.not = parseValue(value);
        break;
      case '=~':
        result.contains = value;
        break;
      case '>':
        result.gt = Number(value);
        break;
      case '>=':
        result.gte = Number(value);
        break;
      case '<':
        result.lt = Number(value);
        break;
      case '<=':
        result.lte = Number(value);
        break;
    }

    return result;
  }

  return { name: trimmed, exists: true };
}
