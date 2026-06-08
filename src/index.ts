#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { createInitCommand } from './commands/init';
import { createRouteCommand } from './commands/route';
import { createCaseCommand } from './commands/case';
import { createServeCommand } from './commands/serve';
import { createExportCommand } from './commands/export';

const pkg = require('../package.json');

const program = new Command();

program
  .name('mock')
  .description(chalk.cyan('Mock API CLI - 接口模拟命令行工具'))
  .version(pkg.version, '-v, --version', '显示版本号')
  .helpOption('-h, --help', '显示帮助信息');

program.addCommand(createInitCommand());
program.addCommand(createRouteCommand());
program.addCommand(createCaseCommand());
program.addCommand(createServeCommand());
program.addCommand(createExportCommand());

program.addHelpText('after', `

${chalk.cyan('快速开始:')}
  ${chalk.gray('1.')} ${chalk.green('mock init')}              初始化项目
  ${chalk.gray('2.')} ${chalk.green('mock route add')}        新增路由
  ${chalk.gray('3.')} ${chalk.green('mock case add')}         新增响应场景
  ${chalk.gray('4.')} ${chalk.green('mock serve')}             启动服务

${chalk.cyan('常用命令:')}
  ${chalk.green('mock route list')}           查看所有路由
  ${chalk.green('mock route show')}            查看路由详情
  ${chalk.green('mock route validate')}        校验所有配置
  ${chalk.green('mock case list')}             查看场景列表
  ${chalk.green('mock route use')}             切换当前场景
  ${chalk.green('mock export doc')}            导出接口文档
  ${chalk.green('mock export example')}        生成调用示例

${chalk.cyan('高级用法:')}
  ${chalk.gray('-')} 支持按 query/body/header 参数匹配不同响应
  ${chalk.gray('-')} 启动服务时可临时覆盖状态码、延迟、响应体
  ${chalk.gray('-')} 支持热重载，修改配置自动生效
  ${chalk.gray('-')} 导出 OpenAPI、Postman、Markdown 多种格式
`);

program.parseAsync(process.argv).catch((error: Error) => {
  console.error(chalk.red(`\n错误: ${error.message}`));
  if (process.env.DEBUG) {
    console.error(chalk.gray(error.stack || ''));
  }
  process.exit(1);
});
