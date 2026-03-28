// Copyright © 2026 Anton Novoselov. All rights reserved.

import { loadConfig, getToken, resetToken, type CLIArgs } from './config.js';
import { setLogLevel, logger } from './logger.js';
import { ClaudeProvider } from './providers/claude.js';
import { CodexProvider } from './providers/codex.js';
import { GeminiProvider } from './providers/gemini.js';
import type { CLIProvider } from './providers/types.js';
import { startServer } from './server.js';
import { runDoctor } from './doctor.js';

function parseArgs(argv: string[]): { command: string; args: CLIArgs; flags: Set<string> } {
  const command = argv[2] ?? 'start';
  const args: CLIArgs = {};
  const flags = new Set<string>();

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];

    switch (arg) {
      case '--port': args.port = parseInt(next ?? '', 10); i++; break;
      case '--host': args.host = next; i++; break;
      case '--token': args.token = next; i++; break;
      case '--claude-path': args.claudePath = next; i++; break;
      case '--codex-path': args.codexPath = next; i++; break;
      case '--gemini-path': args.geminiPath = next; i++; break;
      case '--reset': flags.add('reset'); break;
      default: break;
    }
  }

  return { command, args, flags };
}

function printHelp(): void {
  console.log(`
VivAgents — Standalone CLI Agents Server

Usage:
  vivagents [command] [options]

Commands:
  start          Start the server (default)
  check          Check which CLI providers are available
  doctor         Diagnose issues (binary, auth, port, config)
  token          Show the current auth token
  token --reset  Generate a new auth token
  help           Show this help message

Options:
  --port <number>        Server port (default: 3456)
  --host <string>        Server host (default: 0.0.0.0)
  --token <string>       Auth token (default: auto-generated)
  --claude-path <path>   Custom path to claude binary
  --codex-path <path>    Custom path to codex binary
  --gemini-path <path>   Custom path to gemini binary

Config:
  Config file: ~/.vivagents/config.json
  Env vars:    VIVAGENTS_PORT, VIVAGENTS_HOST, VIVAGENTS_TOKEN, etc.
  Priority:    CLI args > env vars > config file > defaults
`);
}

function createProviders(config: ReturnType<typeof loadConfig>): Map<string, CLIProvider> {
  const providers = new Map<string, CLIProvider>();

  providers.set('claude', new ClaudeProvider(config.providers.claude, config.timeout));
  providers.set('codex', new CodexProvider(config.providers.codex, config.timeout));
  providers.set('gemini', new GeminiProvider(config.providers.gemini, config.timeout));

  return providers;
}

// --- Main ---

const { command, args, flags } = parseArgs(process.argv);

switch (command) {
  case 'help':
  case '--help':
  case '-h': {
    printHelp();
    break;
  }

  case 'token': {
    if (flags.has('reset')) {
      const newToken = resetToken();
      console.log(`New token: ${newToken}`);
    } else {
      console.log(getToken());
    }
    break;
  }

  case 'check': {
    const config = loadConfig(args);
    setLogLevel('error'); // Suppress info logs during check
    const providers = createProviders(config);

    console.log('\nCLI Provider Status:\n');
    for (const [, provider] of providers) {
      const status = provider.isAvailable ? '✓' : '✗';
      const path = provider.binaryPath ? ` → ${provider.binaryPath}` : '';
      console.log(`  ${status} ${provider.displayName}${path}`);
      if (provider.isAvailable) {
        console.log(`    Models: ${provider.models.join(', ')}`);
        console.log(`    Default: ${provider.defaultModel}`);
      }
    }
    console.log();
    break;
  }

  case 'doctor': {
    const config = loadConfig(args);
    setLogLevel('error');
    const providers = createProviders(config);
    await runDoctor(config, providers);
    break;
  }

  case 'start':
  default: {
    const config = loadConfig(args);
    setLogLevel(config.logLevel);

    const providers = createProviders(config);

    const anyAvailable = [...providers.values()].some(p => p.isAvailable);
    if (!anyAvailable) {
      logger.error('No CLI providers found. Install at least one: claude, codex, or gemini');
      process.exit(1);
    }

    startServer(config.port, config.host, config.token, providers);
    break;
  }
}
