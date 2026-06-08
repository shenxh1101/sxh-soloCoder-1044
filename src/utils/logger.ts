import chalk from 'chalk';

const prefix = {
  info: chalk.blue('[INFO]'),
  success: chalk.green('[SUCCESS]'),
  warning: chalk.yellow('[WARNING]'),
  error: chalk.red('[ERROR]'),
  debug: chalk.gray('[DEBUG]'),
};

export const logger = {
  info(message: string, ...args: any[]) {
    console.log(`${prefix.info} ${message}`, ...args);
  },
  success(message: string, ...args: any[]) {
    console.log(`${prefix.success} ${message}`, ...args);
  },
  warning(message: string, ...args: any[]) {
    console.log(`${prefix.warning} ${message}`, ...args);
  },
  error(message: string, ...args: any[]) {
    console.error(`${prefix.error} ${message}`, ...args);
  },
  debug(message: string, ...args: any[]) {
    if (process.env.DEBUG) {
      console.log(`${prefix.debug} ${message}`, ...args);
    }
  },
  raw(message: string) {
    console.log(message);
  },
  table(data: any[][], headers: string[]) {
    const { table } = require('table');
    const config = {
      header: {
        alignment: 'center',
        content: headers.join(' | '),
      },
    };
    console.log(table([headers, ...data]));
  },
};
