import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ConfigManager } from '../utils/config';
import { logger } from '../utils/logger';
import { Route, ResponseCase } from '../types';

export function createExportCommand(): Command {
  const command = new Command('export');

  command
    .description('导出接口说明文档和调用示例')
    .addCommand(createDocCommand())
    .addCommand(createExampleCommand())
    .addCommand(createOpenAPICommand())
    .addCommand(createPostmanCommand());

  return command;
}

function createDocCommand(): Command {
  return new Command('doc')
    .description('导出接口说明文档 (Markdown)')
    .option('-o, --output <file>', '输出文件路径', 'API_DOC.md')
    .option('-t, --title <title>', '文档标题', 'API 接口文档')
    .option('--include-cases', '包含所有场景的详细说明', true)
    .option('--no-include-cases', '不包含场景详情')
    .action(async (options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();
      const config = configManager.getConfig();
      const routes = await configManager.loadAllRoutes();

      if (routes.length === 0) {
        logger.warning('暂无路由配置，跳过导出');
        return;
      }

      const doc = generateMarkdownDoc(routes, {
        title: options.title,
        includeCases: options.includeCases,
        baseUrl: config.baseUrl,
        projectName: config.name,
        version: config.version,
      });

      const outputPath = path.resolve(options.output);
      await fs.writeFile(outputPath, doc);
      logger.success(`文档已导出: ${chalk.cyan(outputPath)}`);
    });
}

function createExampleCommand(): Command {
  return new Command('example')
    .description('生成接口调用示例代码')
    .arguments('[method] [path]')
    .option('-o, --output <file>', '输出文件路径')
    .option('-l, --language <lang>', '语言: curl|javascript|python|typescript|fetch|axios', 'curl')
    .option('-c, --case <caseName>', '使用指定场景')
    .option('--host <host>', '接口地址', 'http://localhost:3000')
    .option('--all', '生成所有接口的示例', false)
    .action(async (method: string | undefined, routePath: string | undefined, options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();
      const config = configManager.getConfig();

      let routes: Route[];
      if (method && routePath) {
        const route = await configManager.loadRoute(method.toUpperCase(), routePath);
        if (!route) {
          logger.error(`路由不存在: ${method.toUpperCase()} ${routePath}`);
          process.exit(1);
        }
        routes = [route];
      } else if (options.all) {
        routes = await configManager.loadAllRoutes();
      } else {
        logger.error('请指定接口 (method path) 或使用 --all 生成所有接口');
        process.exit(1);
      }

      const host = options.host.replace(/\/$/, '');
      const examples = routes.map(route => {
        const caseName = options.case || route.activeCase || 'default';
        const caseItem = route.cases.find(c => c.name === caseName) || route.cases[0];
        return generateExample(route, caseItem, options.language, host + config.baseUrl);
      });

      const result = examples.join('\n\n');

      if (options.output) {
        const outputPath = path.resolve(options.output);
        await fs.writeFile(outputPath, result);
        logger.success(`示例已导出: ${chalk.cyan(outputPath)}`);
      } else {
        logger.raw(result);
      }
    });
}

function createOpenAPICommand(): Command {
  return new Command('openapi')
    .description('导出 OpenAPI 3.0 规范文档')
    .option('-o, --output <file>', '输出文件路径', 'openapi.yaml')
    .option('-f, --format <format>', '格式: yaml|json', 'yaml')
    .option('-t, --title <title>', 'API 标题', 'Mock API')
    .option('-v, --version <version>', 'API 版本', '1.0.0')
    .action(async (options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();
      const config = configManager.getConfig();
      const routes = await configManager.loadAllRoutes();

      if (routes.length === 0) {
        logger.warning('暂无路由配置，跳过导出');
        return;
      }

      const openapi = generateOpenAPI(routes, {
        title: options.title,
        version: options.version,
        baseUrl: config.baseUrl,
      });

      const outputPath = path.resolve(options.output);
      let content: string;

      if (options.format === 'json') {
        content = JSON.stringify(openapi, null, 2);
      } else {
        content = yaml.dump(openapi, { indent: 2, noRefs: true });
      }

      await fs.writeFile(outputPath, content);
      logger.success(`OpenAPI 文档已导出: ${chalk.cyan(outputPath)}`);
    });
}

function createPostmanCommand(): Command {
  return new Command('postman')
    .description('导出 Postman 集合文件')
    .option('-o, --output <file>', '输出文件路径', 'postman_collection.json')
    .option('-n, --name <name>', '集合名称', 'Mock API Collection')
    .option('--host <host>', '接口地址变量', '{{baseUrl}}')
    .action(async (options) => {
      const configManager = new ConfigManager();
      await configManager.ensureProject();
      const config = configManager.getConfig();
      const routes = await configManager.loadAllRoutes();

      if (routes.length === 0) {
        logger.warning('暂无路由配置，跳过导出');
        return;
      }

      const collection = generatePostmanCollection(routes, {
        name: options.name,
        host: options.host,
        baseUrl: config.baseUrl,
      });

      const outputPath = path.resolve(options.output);
      await fs.writeFile(outputPath, JSON.stringify(collection, null, 2));
      logger.success(`Postman 集合已导出: ${chalk.cyan(outputPath)}`);
    });
}

function generateMarkdownDoc(routes: Route[], options: {
  title: string;
  includeCases: boolean;
  baseUrl: string;
  projectName: string;
  version: string;
}): string {
  const lines: string[] = [];

  lines.push(`# ${options.title}`);
  lines.push('');
  lines.push(`**项目**: ${options.projectName} v${options.version}`);
  lines.push(`**基础路径**: \`${options.baseUrl}\``);
  lines.push(`**生成时间**: ${new Date().toLocaleString()}`);
  lines.push('');
  lines.push(`## 接口列表`);
  lines.push('');
  lines.push('| 方法 | 路径 | 描述 | 场景数 |');
  lines.push('|------|------|------|--------|');

  for (const route of routes) {
    lines.push(`| ${route.method} | \`${route.path}\` | ${route.description || '-'} | ${route.cases.length} |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  for (const route of routes) {
    lines.push(`## ${route.method} ${route.path}`);
    lines.push('');
    if (route.description) {
      lines.push(`**描述**: ${route.description}`);
      lines.push('');
    }
    if (route.tags?.length) {
      lines.push(`**标签**: ${route.tags.join(', ')}`);
      lines.push('');
    }
    lines.push(`**当前场景**: ${route.activeCase || '-'}`);
    lines.push('');

    if (options.includeCases) {
      lines.push(`### 响应场景`);
      lines.push('');

      for (const caseItem of route.cases) {
        const defaultTag = caseItem.default ? ` <span style="color:blue">[默认]</span>` : '';
        const activeTag = route.activeCase === caseItem.name ? ` <span style="color:orange">[当前]</span>` : '';

        lines.push(`#### ${caseItem.name}${defaultTag}${activeTag}`);
        lines.push('');
        if (caseItem.description) {
          lines.push(`${caseItem.description}`);
          lines.push('');
        }
        lines.push(`- **状态码**: \`${caseItem.statusCode}\``);
        lines.push(`- **延迟**: \`${caseItem.delay || 0}ms\``);
        if (caseItem.headers && Object.keys(caseItem.headers).length > 0) {
          lines.push(`- **响应头**:`);
          for (const [k, v] of Object.entries(caseItem.headers)) {
            lines.push(`  - \`${k}: ${v}\``);
          }
        }
        if (caseItem.conditions) {
          lines.push(`- **匹配条件**:`);
          if (caseItem.conditions.query?.length) {
            lines.push(`  - Query: ${JSON.stringify(caseItem.conditions.query)}`);
          }
          if (caseItem.conditions.body?.length) {
            lines.push(`  - Body: ${JSON.stringify(caseItem.conditions.body)}`);
          }
          if (caseItem.conditions.headers?.length) {
            lines.push(`  - Headers: ${JSON.stringify(caseItem.conditions.headers)}`);
          }
        }
        lines.push('');
        lines.push('```json');
        lines.push(typeof caseItem.body === 'string' ? caseItem.body : JSON.stringify(caseItem.body, null, 2));
        lines.push('```');
        lines.push('');
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

function generateExample(route: Route, caseItem: ResponseCase, language: string, baseUrl: string): string {
  const fullUrl = (baseUrl + route.path).replace(/\/+/g, '/');
  const body = typeof caseItem.body === 'string' ? caseItem.body : JSON.stringify(caseItem.body, null, 2);

  switch (language.toLowerCase()) {
    case 'curl':
      return `# ${route.method} ${route.path} - ${caseItem.name}\n` +
        (caseItem.description ? `# ${caseItem.description}\n` : '') +
        `curl -X ${route.method} "${fullUrl}" \\\n` +
        (route.method !== 'GET' && caseItem.body !== undefined ?
          `  -H "Content-Type: application/json" \\\n  -d '${typeof caseItem.body === 'string' ? caseItem.body : JSON.stringify(caseItem.body)}'` :
          '');

    case 'javascript':
    case 'fetch':
      return `// ${route.method} ${route.path} - ${caseItem.name}\n` +
        `fetch('${fullUrl}', {\n` +
        `  method: '${route.method}',\n` +
        `  headers: {\n` +
        `    'Content-Type': 'application/json'\n` +
        `  }\n` +
        (route.method !== 'GET' && caseItem.body !== undefined ?
          `,\n  body: JSON.stringify(${typeof caseItem.body === 'string' ? '{}' : JSON.stringify(caseItem.body, null, 2).split('\n').join('\n  ')})\n` :
          '\n') +
        `})\n` +
        `.then(res => res.json())\n` +
        `.then(data => console.log(data))\n` +
        `.catch(err => console.error(err));`;

    case 'typescript':
    case 'axios':
      return `// ${route.method} ${route.path} - ${caseItem.name}\n` +
        `import axios from 'axios';\n\n` +
        `async function callApi() {\n` +
        `  try {\n` +
        `    const response = await axios.${route.method.toLowerCase()}('${fullUrl}'` +
        (route.method !== 'GET' && caseItem.body !== undefined ?
          `, ${typeof caseItem.body === 'string' ? '{}' : JSON.stringify(caseItem.body, null, 2).split('\n').join('\n    ')}` : '') +
        `);\n` +
        `    console.log(response.data);\n` +
        `  } catch (error) {\n` +
        `    console.error(error);\n` +
        `  }\n` +
        `}`;

    case 'python':
      return `# ${route.method} ${route.path} - ${caseItem.name}\n` +
        `import requests\n\n` +
        `url = '${fullUrl}'\n` +
        (route.method !== 'GET' && caseItem.body !== undefined ?
          `payload = ${typeof caseItem.body === 'string' ? '{}' : JSON.stringify(caseItem.body, null, 2).split('\n').join('\n')}\n\n` :
          '\n') +
        `response = requests.${route.method.toLowerCase()}(url` +
        (route.method !== 'GET' && caseItem.body !== undefined ? `, json=payload` : '') +
        `)\n` +
        `print(response.status_code)\n` +
        `print(response.json())`;

    default:
      return `# ${route.method} ${route.path} - ${caseItem.name}\n` +
        `# 响应示例 (状态码: ${caseItem.statusCode}, 延迟: ${caseItem.delay || 0}ms)\n` +
        body;
  }
}

function generateOpenAPI(routes: Route[], options: {
  title: string;
  version: string;
  baseUrl: string;
}): any {
  const paths: Record<string, any> = {};

  for (const route of routes) {
    if (!paths[route.path]) {
      paths[route.path] = {};
    }

    const defaultCase = route.cases.find(c => c.default) || route.cases[0];

    paths[route.path][route.method.toLowerCase()] = {
      summary: route.description || `${route.method} ${route.path}`,
      tags: route.tags || [],
      parameters: route.path.includes(':') ? route.path.split('/')
        .filter(p => p.startsWith(':'))
        .map(p => ({
          name: p.slice(1),
          in: 'path',
          required: true,
          schema: { type: 'string' },
        })) : [],
      responses: {
        [defaultCase.statusCode]: {
          description: defaultCase.description || '成功',
          content: {
            'application/json': {
              example: defaultCase.body,
            },
          },
        },
        ...route.cases.filter(c => c !== defaultCase).reduce((acc, c) => {
          acc[c.statusCode] = {
            description: c.description || c.name,
            content: {
              'application/json': {
                example: c.body,
              },
            },
          };
          return acc;
        }, {} as Record<string, any>),
      },
    };
  }

  return {
    openapi: '3.0.0',
    info: {
      title: options.title,
      version: options.version,
    },
    servers: [
      {
        url: options.baseUrl,
      },
    ],
    paths,
  };
}

function generatePostmanCollection(routes: Route[], options: {
  name: string;
  host: string;
  baseUrl: string;
}): any {
  const items = routes.map(route => {
    const defaultCase = route.cases.find(c => c.default) || route.cases[0];

    return {
      name: `${route.method} ${route.path}`,
      request: {
        method: route.method,
        header: [{
          key: 'Content-Type',
          value: 'application/json',
        }],
        url: {
          raw: options.host + options.baseUrl + route.path,
          host: [options.host],
          path: (options.baseUrl + route.path).split('/').filter(Boolean),
        },
        ...(route.method !== 'GET' && defaultCase.body !== undefined ? {
          body: {
            mode: 'raw',
            raw: typeof defaultCase.body === 'string' ? defaultCase.body : JSON.stringify(defaultCase.body, null, 2),
            options: {
              raw: {
                language: 'json',
              },
            },
          },
        } : {}),
      },
      response: route.cases.map(c => ({
        name: c.name,
        originalRequest: {
          method: route.method,
          header: [{ key: 'Content-Type', value: 'application/json' }],
          url: options.host + options.baseUrl + route.path,
        },
        status: `HTTP ${c.statusCode}`,
        code: c.statusCode,
        header: c.headers ? Object.entries(c.headers).map(([k, v]) => ({ key: k, value: v })) : [],
        body: typeof c.body === 'string' ? c.body : JSON.stringify(c.body, null, 2),
      })),
    };
  });

  return {
    info: {
      name: options.name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      {
        key: 'baseUrl',
        value: 'http://localhost:3000',
      },
    ],
    item: items,
  };
}
