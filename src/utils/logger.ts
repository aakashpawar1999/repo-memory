import chalk from "chalk";

export enum LogLevel {
  SILENT = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4,
}

let currentLevel = LogLevel.INFO;

export function setLogLevel(level: LogLevel) {
  currentLevel = level;
}

export const logger = {
  error(...args: unknown[]) {
    if (currentLevel >= LogLevel.ERROR) {
      console.error(chalk.red("✖"), ...args);
    }
  },

  warn(...args: unknown[]) {
    if (currentLevel >= LogLevel.WARN) {
      console.warn(chalk.yellow("⚠"), ...args);
    }
  },

  info(...args: unknown[]) {
    if (currentLevel >= LogLevel.INFO) {
      console.log(chalk.blue("ℹ"), ...args);
    }
  },

  success(...args: unknown[]) {
    if (currentLevel >= LogLevel.INFO) {
      console.log(chalk.green("✔"), ...args);
    }
  },

  debug(...args: unknown[]) {
    if (currentLevel >= LogLevel.DEBUG) {
      console.log(chalk.gray("⊙"), ...args);
    }
  },

  step(label: string, detail: string) {
    if (currentLevel >= LogLevel.INFO) {
      console.log(chalk.cyan(`  ├── ${label}`), chalk.dim(detail));
    }
  },

  tree(label: string, isLast = false) {
    if (currentLevel >= LogLevel.INFO) {
      const prefix = isLast ? "  └── " : "  ├── ";
      console.log(chalk.dim(prefix) + label);
    }
  },

  header(text: string) {
    if (currentLevel >= LogLevel.INFO) {
      console.log();
      console.log(chalk.bold.white(` ${text}`));
    }
  },

  blank() {
    if (currentLevel >= LogLevel.INFO) {
      console.log();
    }
  },
};
