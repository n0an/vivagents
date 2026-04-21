// Copyright © 2026 Anton Novoselov. All rights reserved.

import type { OpenAIMessage } from '../translator/openaiToClaude.js';

export interface EnhanceParams {
  text: string;
  systemPrompt: string;
  model: string;
}

export interface ChatCompletionsParams {
  messages: OpenAIMessage[];
  model: string;
  stream: boolean;
  /** Max tokens - currently informational; not all CLIs expose a direct flag. */
  maxTokens?: number;
  /** Per-request timeout override (ms). Falls back to provider's default. */
  timeoutMs?: number;
  /** For streaming: called with each OpenAI-format SSE chunk string (including trailing "\n\n"). */
  onChunk?: (sseChunk: string) => void;
  /** Aborts the underlying subprocess if triggered (client disconnect). */
  abortSignal?: AbortSignal;
}

export interface ChatCompletionsResult {
  fullText: string;
}

export interface CLIProvider {
  readonly name: string;
  readonly displayName: string;
  readonly models: string[];
  readonly defaultModel: string;
  isAvailable: boolean;
  binaryPath: string | null;

  findBinary(): string | null;
  enhance(params: EnhanceParams): Promise<string>;

  /**
   * OpenAI-compatible chat completions. Optional per provider - only implementations
   * that support multi-turn flattening + streaming should provide this.
   */
  chatCompletions?(params: ChatCompletionsParams): Promise<ChatCompletionsResult>;
}
