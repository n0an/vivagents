// Copyright © 2026 Anton Novoselov. All rights reserved.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

/**
 * Find a CLI binary by name, checking custom path, PATH, nvm, and known locations.
 */
export function findBinary(name: string, customPath?: string | null): string | null {
  // 1. Custom path from config
  if (customPath && existsSync(customPath)) return customPath;

  // 2. PATH lookup via `which`
  try {
    const result = execSync(`which ${name}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (result && existsSync(result)) return result;
  } catch {
    // Not found in PATH
  }

  // 3. NVM versions (for Node.js-based CLIs: codex, gemini)
  const nvmDir = join(homedir(), '.nvm', 'versions', 'node');
  if (existsSync(nvmDir)) {
    try {
      const versions = readdirSync(nvmDir).sort().reverse(); // Latest first
      for (const version of versions) {
        const binPath = join(nvmDir, version, 'bin', name);
        if (existsSync(binPath)) return binPath;
      }
    } catch {
      // Can't read nvm dir
    }
  }

  // 4. Known paths
  const home = homedir();
  const knownPaths = [
    join(home, `.claude/local/bin/${name}`), // Claude-specific
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    join(home, `.local/bin/${name}`),
    `/usr/bin/${name}`,
  ];

  for (const p of knownPaths) {
    if (existsSync(p)) return p;
  }

  return null;
}

/**
 * Build an enriched PATH that includes nvm node versions and common bin dirs.
 * This ensures Node.js shebangs resolve correctly when spawning CLI processes.
 */
export function enrichedPATH(): string {
  const parts: string[] = [];
  const home = homedir();

  // Add nvm node versions (latest first)
  const nvmDir = join(home, '.nvm', 'versions', 'node');
  if (existsSync(nvmDir)) {
    try {
      const versions = readdirSync(nvmDir).sort().reverse();
      for (const version of versions) {
        parts.push(join(nvmDir, version, 'bin'));
      }
    } catch {
      // Ignore
    }
  }

  // Common bin dirs
  parts.push('/opt/homebrew/bin');
  parts.push('/usr/local/bin');
  parts.push(join(home, '.local/bin'));

  // Existing PATH
  if (process.env['PATH']) {
    parts.push(process.env['PATH']);
  }

  return parts.join(':');
}
