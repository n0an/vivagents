// Copyright © 2026 Anton Novoselov. All rights reserved.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

export interface ProviderConfig {
  enabled: boolean;
  path: string | null;
  models: string[];
  defaultModel: string;
}

export interface Config {
  port: number;
  host: string;
  token: string;
  timeout: number;
  logLevel: string;
  providers: {
    claude: ProviderConfig;
    codex: ProviderConfig;
    gemini: ProviderConfig;
  };
}

const CONFIG_DIR = join(homedir(), '.vivagents');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const TOKEN_FILE = join(CONFIG_DIR, 'token');

const DEFAULT_CONFIG: Config = {
  port: 3456,
  host: '0.0.0.0',
  token: '',
  timeout: 90_000,
  logLevel: 'info',
  providers: {
    claude: {
      enabled: true,
      path: null,
      models: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'],
      defaultModel: 'claude-sonnet-4-6',
    },
    codex: {
      enabled: true,
      path: null,
      models: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2', 'gpt-5.1'],
      defaultModel: 'gpt-5.4',
    },
    gemini: {
      enabled: true,
      path: null,
      models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-pro-preview', 'gemini-3-flash-preview'],
      defaultModel: 'gemini-2.5-flash',
    },
  },
};

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

function loadOrCreateToken(): string {
  ensureConfigDir();
  if (existsSync(TOKEN_FILE)) {
    const token = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (token) return token;
  }
  const token = generateToken();
  writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  return token;
}

export function resetToken(): string {
  ensureConfigDir();
  const token = generateToken();
  writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  return token;
}

export function getToken(): string {
  return loadOrCreateToken();
}

function loadConfigFile(): PartialConfigWithProviders {
  // Check local directory first, then ~/.vivagents/
  const localConfig = join(process.cwd(), 'vivagents.config.json');
  const configPath = existsSync(localConfig) ? localConfig : CONFIG_FILE;

  if (!existsSync(configPath)) return {};

  try {
    const raw = readFileSync(configPath, 'utf8');
    return JSON.parse(raw) as PartialConfigWithProviders;
  } catch {
    return {};
  }
}

interface PartialConfigWithProviders extends Omit<Partial<Config>, 'providers'> {
  providers?: Partial<Config['providers']>;
}

function loadEnvVars(): PartialConfigWithProviders {
  const config: PartialConfigWithProviders = {};

  if (process.env['VIVAGENTS_PORT']) config.port = parseInt(process.env['VIVAGENTS_PORT'], 10);
  if (process.env['VIVAGENTS_HOST']) config.host = process.env['VIVAGENTS_HOST'];
  if (process.env['VIVAGENTS_TOKEN']) config.token = process.env['VIVAGENTS_TOKEN'];
  if (process.env['VIVAGENTS_TIMEOUT']) config.timeout = parseInt(process.env['VIVAGENTS_TIMEOUT'], 10);
  if (process.env['VIVAGENTS_LOG_LEVEL']) config.logLevel = process.env['VIVAGENTS_LOG_LEVEL'];

  // Provider paths from env
  if (process.env['VIVAGENTS_CLAUDE_PATH'] || process.env['VIVAGENTS_CODEX_PATH'] || process.env['VIVAGENTS_GEMINI_PATH']) {
    const providers: Partial<Config['providers']> = {};
    if (process.env['VIVAGENTS_CLAUDE_PATH']) {
      providers.claude = { ...DEFAULT_CONFIG.providers.claude, path: process.env['VIVAGENTS_CLAUDE_PATH'] };
    }
    if (process.env['VIVAGENTS_CODEX_PATH']) {
      providers.codex = { ...DEFAULT_CONFIG.providers.codex, path: process.env['VIVAGENTS_CODEX_PATH'] };
    }
    if (process.env['VIVAGENTS_GEMINI_PATH']) {
      providers.gemini = { ...DEFAULT_CONFIG.providers.gemini, path: process.env['VIVAGENTS_GEMINI_PATH'] };
    }
    config.providers = providers;
  }

  return config;
}

export interface CLIArgs {
  port?: number;
  host?: string;
  token?: string;
  claudePath?: string;
  codexPath?: string;
  geminiPath?: string;
}

function mergeProviders(
  base: Config['providers'],
  override?: Partial<Config['providers']>,
  cliPaths?: { claude?: string; codex?: string; gemini?: string }
): Config['providers'] {
  const result = { ...base };

  if (override?.claude) result.claude = { ...result.claude, ...override.claude };
  if (override?.codex) result.codex = { ...result.codex, ...override.codex };
  if (override?.gemini) result.gemini = { ...result.gemini, ...override.gemini };

  if (cliPaths?.claude) result.claude = { ...result.claude, path: cliPaths.claude };
  if (cliPaths?.codex) result.codex = { ...result.codex, path: cliPaths.codex };
  if (cliPaths?.gemini) result.gemini = { ...result.gemini, path: cliPaths.gemini };

  return result;
}

export function loadConfig(cliArgs: CLIArgs = {}): Config {
  const fileConfig = loadConfigFile();
  const envConfig = loadEnvVars();

  // Determine token: CLI > env > file > auto-generate
  const token = cliArgs.token
    ?? envConfig.token
    ?? fileConfig.token
    ?? loadOrCreateToken();

  const config: Config = {
    port: cliArgs.port ?? envConfig.port ?? fileConfig.port ?? DEFAULT_CONFIG.port,
    host: cliArgs.host ?? envConfig.host ?? fileConfig.host ?? DEFAULT_CONFIG.host,
    token,
    timeout: envConfig.timeout ?? fileConfig.timeout ?? DEFAULT_CONFIG.timeout,
    logLevel: envConfig.logLevel ?? fileConfig.logLevel ?? DEFAULT_CONFIG.logLevel,
    providers: mergeProviders(
      DEFAULT_CONFIG.providers,
      { ...fileConfig.providers, ...envConfig.providers },
      { claude: cliArgs.claudePath, codex: cliArgs.codexPath, gemini: cliArgs.geminiPath }
    ),
  };

  return config;
}
