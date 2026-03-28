// Copyright © 2026 Anton Novoselov. All rights reserved.

import type { CLIProvider, EnhanceParams } from './types.js';
import type { ProviderConfig } from '../config.js';
import { findBinary, enrichedPATH } from './discovery.js';
import { spawnCLI } from '../utils/process.js';
import { detectError } from '../utils/error-detection.js';
import { logger } from '../logger.js';

export class ClaudeProvider implements CLIProvider {
  readonly name = 'claude';
  readonly displayName = 'Claude CLI';
  readonly models: string[];
  readonly defaultModel: string;

  isAvailable = false;
  binaryPath: string | null = null;

  private timeout: number;

  constructor(config: ProviderConfig, timeout: number) {
    this.models = config.models;
    this.defaultModel = config.defaultModel;
    this.timeout = timeout;

    if (config.enabled) {
      this.binaryPath = this.findBinary(config.path);
      this.isAvailable = this.binaryPath !== null;
    }

    if (this.isAvailable) {
      logger.info(`Claude CLI found at ${this.binaryPath}`);
    } else if (config.enabled) {
      logger.warn('Claude CLI not found');
    }
  }

  findBinary(customPath?: string | null): string | null {
    return findBinary('claude', customPath);
  }

  async enhance(params: EnhanceParams): Promise<string> {
    if (!this.binaryPath) {
      throw Object.assign(new Error('Claude CLI binary not found'), { code: 'BINARY_NOT_FOUND', status: 500 });
    }

    const args = [
      '--print',
      '--output-format', 'text',
      '--model', params.model || this.defaultModel,
      '--max-turns', '1',
      '--system-prompt', params.systemPrompt,
      params.text,
    ];

    const result = await spawnCLI(this.binaryPath, args, { PATH: enrichedPATH() }, this.timeout);
    const error = detectError(result.stderr, result.exitCode, result.stdout);

    if (error) {
      throw Object.assign(new Error(error.message), { code: error.code, status: error.status });
    }

    return result.stdout;
  }
}
