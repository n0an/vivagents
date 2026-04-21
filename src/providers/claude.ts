// Copyright © 2026 Anton Novoselov. All rights reserved.

import { randomUUID } from 'node:crypto';
import type {
  CLIProvider,
  EnhanceParams,
  ChatCompletionsParams,
  ChatCompletionsResult,
} from './types.js';
import type { ProviderConfig } from '../config.js';
import { findBinary, enrichedPATH } from './discovery.js';
import { spawnCLI, spawnCLIWithStdin, spawnCLIStreaming } from '../utils/process.js';
import { detectError } from '../utils/error-detection.js';
import { logger } from '../logger.js';
import { openaiMessagesToPrompt } from '../translator/openaiToClaude.js';
import {
  streamJsonLineToOpenAISSE,
  buildRoleChunk,
} from '../translator/claudeToOpenaiSSE.js';

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

    // Unset ANTHROPIC_API_KEY so Claude CLI uses OAuth session instead of a potentially stale key
    const result = await spawnCLI(this.binaryPath, args, { PATH: enrichedPATH(), ANTHROPIC_API_KEY: '' }, this.timeout);

    if (result.stderr) {
      logger.debug(`Claude stderr: ${result.stderr}`);
    }

    const error = detectError(result.stderr, result.exitCode, result.stdout);

    if (error) {
      // Include both stderr and stdout in the error for debugging
      const fullMessage = result.stderr || result.stdout || error.message;
      logger.error(`Claude CLI error details: stderr="${result.stderr}", stdout="${result.stdout.slice(0, 200)}"`);
      throw Object.assign(new Error(fullMessage), { code: error.code, status: error.status });
    }

    return result.stdout;
  }

  async chatCompletions(params: ChatCompletionsParams): Promise<ChatCompletionsResult> {
    if (!this.binaryPath) {
      throw Object.assign(new Error('Claude CLI binary not found'), {
        code: 'BINARY_NOT_FOUND',
        status: 500,
      });
    }

    const { systemPrompt, userPrompt } = openaiMessagesToPrompt(params.messages);

    if (!userPrompt) {
      throw Object.assign(new Error('messages[] must contain at least one user or assistant turn'), {
        code: 'INVALID_REQUEST',
        status: 400,
      });
    }

    const model = params.model || this.defaultModel;
    const timeout = params.timeoutMs ?? this.timeout;
    const env = { PATH: enrichedPATH(), ANTHROPIC_API_KEY: '' };

    const baseArgs = [
      '--print',
      '--model', model,
    ];
    if (systemPrompt) {
      baseArgs.push('--append-system-prompt', systemPrompt);
    }

    if (params.stream) {
      return this.runStreaming(baseArgs, userPrompt, env, timeout, model, params);
    }
    return this.runNonStreaming(baseArgs, userPrompt, env, timeout);
  }

  private async runNonStreaming(
    baseArgs: string[],
    stdinPrompt: string,
    env: Record<string, string>,
    timeout: number
  ): Promise<ChatCompletionsResult> {
    const args = [...baseArgs, '--output-format', 'text'];

    const result = await spawnCLIWithStdin(this.binaryPath!, args, stdinPrompt, env, timeout);

    if (result.stderr) {
      logger.debug(`Claude chat stderr: ${result.stderr}`);
    }

    const error = detectError(result.stderr, result.exitCode, result.stdout);
    if (error) {
      const fullMessage = result.stderr || result.stdout || error.message;
      logger.error(
        `Claude chat error: stderr="${result.stderr}", stdout="${result.stdout.slice(0, 200)}"`
      );
      throw Object.assign(new Error(fullMessage), { code: error.code, status: error.status });
    }

    return { fullText: result.stdout };
  }

  private async runStreaming(
    baseArgs: string[],
    stdinPrompt: string,
    env: Record<string, string>,
    timeout: number,
    model: string,
    params: ChatCompletionsParams
  ): Promise<ChatCompletionsResult> {
    // --verbose is required for stream-json to produce output in -p / --print mode.
    const args = [...baseArgs, '--output-format', 'stream-json', '--verbose'];

    const chatId = `chatcmpl-${randomUUID()}`;
    const ctx = { chatId, model };
    let fullText = '';
    let sentRoleChunk = false;

    const onLine = (line: string) => {
      if (!sentRoleChunk && params.onChunk) {
        params.onChunk(buildRoleChunk(ctx));
        sentRoleChunk = true;
      }
      for (const sse of streamJsonLineToOpenAISSE(line, ctx)) {
        // Extract content deltas for fullText accumulation (for logs / non-streaming fallback)
        try {
          const payload = sse.startsWith('data: ') ? sse.slice(6).trimEnd() : '';
          if (payload && payload !== '[DONE]') {
            const parsed = JSON.parse(payload);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string') fullText += delta;
          }
        } catch {
          /* ignore parse errors - just accumulate what we can */
        }
        params.onChunk?.(sse);
      }
    };

    const result = await spawnCLIStreaming(this.binaryPath!, args, stdinPrompt, env, timeout, {
      onLine,
      abortSignal: params.abortSignal,
    });

    if (result.stderr) {
      logger.debug(`Claude chat stream stderr: ${result.stderr}`);
    }

    // If we never sent the role chunk (no text was produced), still emit an end marker
    // so the client's SSE parser closes cleanly.
    if (!sentRoleChunk && params.onChunk && result.exitCode === 0) {
      params.onChunk(buildRoleChunk(ctx));
      params.onChunk(
        `data: ${JSON.stringify({
          id: chatId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\n`
      );
      params.onChunk(`data: [DONE]\n\n`);
    }

    const error = detectError(result.stderr, result.exitCode, fullText);
    if (error) {
      const fullMessage = result.stderr || error.message;
      logger.error(`Claude chat stream error: stderr="${result.stderr}", fullText len=${fullText.length}`);
      throw Object.assign(new Error(fullMessage), { code: error.code, status: error.status });
    }

    return { fullText };
  }
}
