import { Command } from 'commander';
import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import { ConfigManager } from '../utils/config';
import { logger } from '../utils/logger';

export function createInitCommand(): Command {
  const command = new Command('init');

  command
    .description('初始化 Mock API 项目')
    .option('-n, --name <name>', '项目名称', 'mock-api-project')
    .option('-p, --port <port>', '服务端口', '3000')
    .option('-b, --base-url <url>', 'API 基础路径', '/api')
    .option('-d, --routes-dir <dir>', '路由配置目录', 'routes')
    .option('-f, --force', '强制覆盖现有配置', false)
    .action(async (options) => {
      try {
        const cwd = process.cwd();
        const configManager = new ConfigManager(cwd);
        const configPath = configManager.getConfigPath();

        if (await fs.pathExists(configPath) && !options.force) {
          logger.error(`项目已存在: ${configPath}`);
          logger.info('使用 -f 或 --force 选项强制覆盖');
          process.exit(1);
        }

        const port = parseInt(options.port, 10);
        const config = await configManager.initConfig({
          name: options.name,
          port,
          baseUrl: options.baseUrl,
          routesDir: options.routesDir,
        });

        const routesDir = path.join(cwd, config.routesDir);
        await fs.mkdirp(routesDir);

        const readmePath = path.join(cwd, 'README.md');
        if (!(await fs.pathExists(readmePath))) {
          await fs.writeFile(
            readmePath,
            `# ${config.name}\n\n## 快速开始\n\n\`\`\`bash\n# 新增路由（路径相对于 baseUrl: ${config.baseUrl}）\nmock route add GET /users\n# 完整访问路径: ${config.baseUrl}/users\n\n# 新增响应场景\nmock case add GET /users success --body '{\"code\":0,\"data\":[]}'\n\n# 启动服务\nmock serve\n\`\`\`\n`
          );
        }

        const exampleRouteDir = path.join(routesDir, '.examples');
        await fs.mkdirp(exampleRouteDir);
        await createExampleRoutes(exampleRouteDir, config.baseUrl);

        logger.success(`项目初始化成功!`);
        logger.raw('');
        logger.raw(chalk.cyan('项目配置:'));
        logger.raw(`  ${chalk.gray('名称:')} ${config.name} v${config.version}`);
        logger.raw(`  ${chalk.gray('端口:')} ${config.port}`);
        logger.raw(`  ${chalk.gray('Base URL:')} ${chalk.yellow(config.baseUrl)}`);
        logger.raw(`  ${chalk.gray('路由目录:')} ${routesDir}/`);
        logger.raw('');
        logger.raw(chalk.cyan('💡 路径说明:'));
        logger.raw(`  添加路由时请使用相对路径（如 ${chalk.yellow('/users')}），完整访问路径 = baseUrl + 路径`);
        logger.raw(`  例如: mock route add GET ${chalk.yellow('/users')} → 访问 ${chalk.cyan(`http://localhost:${config.port}${config.baseUrl}/users`)}`);
        logger.raw('');
        logger.raw(chalk.cyan('下一步:'));
        logger.raw(`  ${chalk.gray('1.')} mock route list                    查看示例路由（含完整路径）`);
        logger.raw(`  ${chalk.gray('2.')} mock route add GET /test           新增路由（相对路径）`);
        logger.raw(`  ${chalk.gray('3.')} mock serve                           启动服务`);
        logger.raw('');
      } catch (error) {
        logger.error(`初始化失败: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  return command;
}

async function createExampleRoutes(dir: string, baseUrl: string): Promise<void> {
  const examples = [
    {
      method: 'GET',
      path: '/users',
      description: '获取用户列表',
      cases: [
        {
          name: 'success',
          description: '成功返回用户列表',
          statusCode: 200,
          default: true,
          body: {
            code: 0,
            message: 'success',
            data: [
              { id: 1, name: '张三', age: 25 },
              { id: 2, name: '李四', age: 30 },
            ],
          },
        },
        {
          name: 'empty',
          description: '空列表',
          statusCode: 200,
          body: {
            code: 0,
            message: 'success',
            data: [],
          },
        },
      ],
    },
    {
      method: 'GET',
      path: '/users/:id',
      description: '获取用户详情',
      cases: [
        {
          name: 'success',
          description: '成功返回用户信息',
          statusCode: 200,
          default: true,
          body: {
            code: 0,
            message: 'success',
            data: { id: 1, name: '张三', age: 25, email: 'zhangsan@example.com' },
          },
          conditions: {
            query: [{ name: 'id', value: '1' }],
          },
        },
        {
          name: 'not_found',
          description: '用户不存在',
          statusCode: 404,
          body: {
            code: 404,
            message: '用户不存在',
            data: null,
          },
        },
      ],
    },
    {
      method: 'POST',
      path: '/users',
      description: '创建用户',
      cases: [
        {
          name: 'success',
          description: '创建成功',
          statusCode: 201,
          delay: 500,
          default: true,
          body: {
            code: 0,
            message: '创建成功',
            data: { id: 3, name: '王五', age: 28 },
          },
        },
        {
          name: 'validation_error',
          description: '参数校验失败',
          statusCode: 400,
          body: {
            code: 400,
            message: '参数校验失败',
            errors: [
              { field: 'name', message: '姓名不能为空' },
              { field: 'age', message: '年龄必须大于0' },
            ],
          },
        },
      ],
    },
  ];

  for (const example of examples) {
    const safePath = example.path.replace(/\//g, '_').replace(/[:*?]/g, '');
    const fileName = `${example.method.toLowerCase()}${safePath}.yaml`;
    const yaml = require('js-yaml');
    const now = new Date().toISOString();
    const content = yaml.dump(
      {
        path: example.path,
        method: example.method,
        description: example.description,
        createdAt: now,
        updatedAt: now,
        cases: example.cases,
      },
      { indent: 2 }
    );
    await fs.writeFile(path.join(dir, fileName), content);
  }
}
