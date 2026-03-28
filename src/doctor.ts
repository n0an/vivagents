// Copyright © 2026 Anton Novoselov. All rights reserved.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { createConnection } from 'node:net';
import type { CLIProvider } from './providers/types.js';
import type { Config } from './config.js';

interface CheckResult {
  label: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

function checkNodeVersion(): CheckResult {
  const version = process.versions['node'] ?? '';
  const major = parseInt(version.split('.')[0] ?? '0', 10);
  return {
    label: 'Node.js',
    ok: major >= 20,
    detail: major >= 20 ? `v${version}` : `v${version} (need >= 20)`,
    fix: major < 20 ? 'Install Node.js 20+: https://nodejs.org' : undefined,
  };
}

function checkConfigFile(): CheckResult {
  const localConfig = join(process.cwd(), 'vivagents.config.json');
  const globalConfig = join(homedir(), '.vivagents', 'config.json');

  if (existsSync(localConfig)) {
    return { label: 'Config file', ok: true, detail: localConfig };
  }
  if (existsSync(globalConfig)) {
    return { label: 'Config file', ok: true, detail: globalConfig };
  }
  return { label: 'Config file', ok: true, detail: 'Not found (using defaults)' };
}

function checkToken(): CheckResult {
  const tokenFile = join(homedir(), '.vivagents', 'token');
  if (existsSync(tokenFile)) {
    return { label: 'Auth token', ok: true, detail: tokenFile };
  }
  return { label: 'Auth token', ok: true, detail: 'Will be auto-generated on first start' };
}

function checkPort(port: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    const conn = createConnection({ port, host: '127.0.0.1' }, () => {
      conn.end();
      resolve({
        label: `Port ${port}`,
        ok: false,
        detail: `Already in use`,
        fix: `Another process is using port ${port}. Use --port to pick a different one, or stop the other process.`,
      });
    });
    conn.on('error', () => {
      resolve({ label: `Port ${port}`, ok: true, detail: 'Available' });
    });
    conn.setTimeout(1000, () => {
      conn.destroy();
      resolve({ label: `Port ${port}`, ok: true, detail: 'Available' });
    });
  });
}

function checkProviderBinary(provider: CLIProvider): CheckResult {
  if (!provider.isAvailable) {
    const installCmd = provider.name === 'claude'
      ? 'curl -fsSL https://claude.ai/install.sh | bash'
      : provider.name === 'codex'
        ? 'npm install -g @openai/codex  OR  brew install codex'
        : 'npm install -g @google/gemini-cli  OR  brew install gemini-cli';

    return {
      label: `${provider.displayName} binary`,
      ok: false,
      detail: 'Not found',
      fix: `Install: ${installCmd}`,
    };
  }
  return {
    label: `${provider.displayName} binary`,
    ok: true,
    detail: provider.binaryPath!,
  };
}

function checkProviderAuth(provider: CLIProvider): CheckResult {
  if (!provider.isAvailable) {
    return { label: `${provider.displayName} auth`, ok: false, detail: 'Skipped (binary not found)' };
  }

  // Check for known auth credential locations
  const home = homedir();
  let authFound = false;
  let authDetail = '';

  switch (provider.name) {
    case 'claude': {
      // Claude stores credentials in ~/.claude/
      const claudeDir = join(home, '.claude');
      authFound = existsSync(claudeDir);
      authDetail = authFound ? `~/.claude/ exists` : 'No ~/.claude/ directory';
      break;
    }
    case 'codex': {
      // Codex stores credentials in ~/.codex/
      const codexDir = join(home, '.codex');
      const codexAuth = join(home, '.config', 'codex');
      authFound = existsSync(codexDir) || existsSync(codexAuth);
      authDetail = authFound ? 'Credentials found' : 'No credentials found';
      break;
    }
    case 'gemini': {
      // Gemini stores credentials in ~/.config/gemini/ or ~/.gemini/
      const geminiConfig = join(home, '.config', 'gemini');
      const geminiDir = join(home, '.gemini');
      authFound = existsSync(geminiConfig) || existsSync(geminiDir);
      authDetail = authFound ? 'Credentials found' : 'No credentials found';
      break;
    }
  }

  if (!authFound) {
    const authCmd = provider.name === 'claude'
      ? 'Run: claude'
      : provider.name === 'codex'
        ? 'Run: codex (select "Sign in with ChatGPT")'
        : 'Run: gemini (select "Sign in with Google")';

    return {
      label: `${provider.displayName} auth`,
      ok: false,
      detail: authDetail,
      fix: `Authenticate: ${authCmd}`,
    };
  }

  return { label: `${provider.displayName} auth`, ok: true, detail: authDetail };
}

function checkEnvConflicts(): CheckResult {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (apiKey && apiKey.length > 0) {
    return {
      label: 'ANTHROPIC_API_KEY',
      ok: false,
      detail: 'Set in environment — will override Claude subscription',
      fix: 'Unset it to use your Claude subscription: unset ANTHROPIC_API_KEY\nVivAgents handles this automatically, but your shell may pass it to other tools.',
    };
  }
  return { label: 'ANTHROPIC_API_KEY', ok: true, detail: 'Not set (good — Claude will use subscription)' };
}

export async function runDoctor(config: Config, providers: Map<string, CLIProvider>): Promise<void> {
  console.log('\nVivAgents Doctor\n');

  const results: CheckResult[] = [];

  // System checks
  results.push(checkNodeVersion());
  results.push(checkConfigFile());
  results.push(checkToken());
  results.push(await checkPort(config.port));
  results.push(checkEnvConflicts());

  // Provider checks
  for (const [, provider] of providers) {
    results.push(checkProviderBinary(provider));
    results.push(checkProviderAuth(provider));
  }

  // Print results
  let issues = 0;
  for (const r of results) {
    const icon = r.ok ? '✓' : '✗';
    console.log(`  ${icon} ${r.label}: ${r.detail}`);
    if (r.fix) {
      console.log(`    → ${r.fix}`);
      issues++;
    }
  }

  console.log();
  if (issues === 0) {
    console.log('  All checks passed!\n');
  } else {
    console.log(`  ${issues} issue${issues > 1 ? 's' : ''} found.\n`);
  }
}
