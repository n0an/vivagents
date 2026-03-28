// Copyright © 2026 Anton Novoselov. All rights reserved.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: string): void {
  if (level in LEVELS) {
    currentLevel = level as LogLevel;
  }
}

function timestamp(): string {
  return new Date().toISOString();
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

export const logger = {
  debug(msg: string, data?: Record<string, unknown>): void {
    if (!shouldLog('debug')) return;
    console.log(`${timestamp()} [DEBUG] ${msg}`, data ? JSON.stringify(data) : '');
  },

  info(msg: string, data?: Record<string, unknown>): void {
    if (!shouldLog('info')) return;
    console.log(`${timestamp()} [INFO]  ${msg}`, data ? JSON.stringify(data) : '');
  },

  warn(msg: string, data?: Record<string, unknown>): void {
    if (!shouldLog('warn')) return;
    console.warn(`${timestamp()} [WARN]  ${msg}`, data ? JSON.stringify(data) : '');
  },

  error(msg: string, data?: Record<string, unknown>): void {
    if (!shouldLog('error')) return;
    console.error(`${timestamp()} [ERROR] ${msg}`, data ? JSON.stringify(data) : '');
  },
};
