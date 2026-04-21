// Copyright © 2026 Anton Novoselov. All rights reserved.

import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { CLIProvider, ChatCompletionsResult } from '../providers/types.js';
import { resolveProviderAlias } from '../providers/aliases.js';
import type { OpenAIMessage } from '../translator/openaiToClaude.js';
import { logger } from '../logger.js';

interface ChatCompletionsRequest {
  model?: string;
  messages?: unknown;
  stream?: boolean;
  temperature?: number; // accepted for compatibility, currently not forwarded
  max_tokens?: number;
  /** Optional - vivagents-specific. Defaults to "claude". */
  provider?: string;
  /** Optional - bearer token alternative (also supported in server). */
  token?: string;
}

interface ErrorBody {
  error: { message: string; code: string; type: string };
}

/**
 * Validate the request body and coerce messages to a typed array.
 * Returns null if invalid (and sends a JSON error response).
 */
function validateBody(
  body: ChatCompletionsRequest,
  providers: Map<string, CLIProvider>
): {
  providerInstance: CLIProvider;
  providerName: string;
  model: string;
  messages: OpenAIMessage[];
  stream: boolean;
  maxTokens: number | undefined;
} | ErrorBody {
  const messagesRaw = body.messages;
  if (!Array.isArray(messagesRaw) || messagesRaw.length === 0) {
    return errBody('messages[] is required and must be non-empty', 'invalid_request_error');
  }

  const messages: OpenAIMessage[] = [];
  for (const m of messagesRaw) {
    if (!m || typeof m !== 'object') continue;
    const rec = m as Record<string, unknown>;
    const role = rec['role'];
    const content = rec['content'];
    if (
      (role === 'system' || role === 'user' || role === 'assistant') &&
      typeof content === 'string'
    ) {
      messages.push({ role, content });
    }
  }

  if (messages.length === 0) {
    return errBody('messages[] contains no valid {role, content} entries', 'invalid_request_error');
  }

  const providerName = resolveProviderAlias(body.provider);
  const providerInstance = providers.get(providerName);
  if (!providerInstance) {
    return errBody(`Unknown provider: ${providerName}`, 'invalid_request_error');
  }
  if (!providerInstance.chatCompletions) {
    return errBody(
      `Provider '${providerName}' does not support chat completions`,
      'invalid_request_error'
    );
  }
  if (!providerInstance.isAvailable) {
    return errBody(`${providerInstance.displayName} is not available`, 'provider_unavailable');
  }

  return {
    providerInstance,
    providerName,
    model: body.model || providerInstance.defaultModel,
    messages,
    stream: body.stream === true,
    maxTokens: typeof body.max_tokens === 'number' ? body.max_tokens : undefined,
  };
}

function errBody(message: string, type: string, code?: string): ErrorBody {
  return { error: { message, code: code ?? type, type } };
}

/**
 * Non-streaming handler.
 * Returns { status, body } for the server to render via sendJSON.
 */
export async function handleChatCompletionsNonStream(
  body: ChatCompletionsRequest,
  providers: Map<string, CLIProvider>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const validated = validateBody(body, providers);
  if ('error' in validated) {
    return { status: 400, body: validated as unknown as Record<string, unknown> };
  }

  const { providerInstance, providerName, model, messages, maxTokens } = validated;
  const startTime = Date.now();

  logger.info(
    `/v1/chat/completions (non-stream): provider=${providerName}, model=${model}, turns=${messages.length}`
  );

  try {
    const result: ChatCompletionsResult = await providerInstance.chatCompletions!({
      messages,
      model,
      stream: false,
      maxTokens,
    });

    const duration = Math.round((Date.now() - startTime) / 10) / 100;
    logger.info(
      `/v1/chat/completions success: provider=${providerName}, model=${model}, resultLength=${result.fullText.length}, duration=${duration}s`
    );

    return {
      status: 200,
      body: {
        id: `chatcmpl-${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: result.fullText },
            finish_reason: 'stop',
          },
        ],
        // TODO: wire real token counts when we have a tokenizer. Zero placeholders keep
        // OpenAI-SDK consumers happy without lying about counts.
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      },
    };
  } catch (err: unknown) {
    const duration = Math.round((Date.now() - startTime) / 10) / 100;
    const error = err as Error & { code?: string; status?: number };
    const status = error.status ?? 500;
    logger.error(
      `/v1/chat/completions FAILED: provider=${providerName}, status=${status}, duration=${duration}s, error=${error.message}`
    );
    return {
      status,
      body: errBody(error.message, error.code ?? 'execution_failed') as unknown as Record<
        string,
        unknown
      >,
    };
  }
}

/**
 * Streaming handler.
 * Writes SSE directly to `res`. Caller must NOT have set response headers yet.
 */
export async function handleChatCompletionsStream(
  body: ChatCompletionsRequest,
  providers: Map<string, CLIProvider>,
  res: ServerResponse
): Promise<void> {
  const validated = validateBody(body, providers);
  if ('error' in validated) {
    res.writeHead(400, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(validated));
    return;
  }

  const { providerInstance, providerName, model, messages, maxTokens } = validated;

  // SSE headers - only write once we're about to stream.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // Force-flush on first write (some proxies/clients need this)
  res.write(':\n\n');

  const abortController = new AbortController();
  let clientDisconnected = false;
  res.on('close', () => {
    clientDisconnected = true;
    abortController.abort();
  });

  const startTime = Date.now();
  logger.info(
    `/v1/chat/completions (stream): provider=${providerName}, model=${model}, turns=${messages.length}`
  );

  try {
    await providerInstance.chatCompletions!({
      messages,
      model,
      stream: true,
      maxTokens,
      abortSignal: abortController.signal,
      onChunk: (sse) => {
        if (!clientDisconnected) res.write(sse);
      },
    });

    const duration = Math.round((Date.now() - startTime) / 10) / 100;
    logger.info(
      `/v1/chat/completions stream done: provider=${providerName}, model=${model}, duration=${duration}s`
    );
  } catch (err: unknown) {
    const error = err as Error & { code?: string };
    logger.error(
      `/v1/chat/completions stream FAILED: provider=${providerName}, error=${error.message}`
    );
    if (!clientDisconnected) {
      const errPayload = {
        error: { message: error.message, code: error.code ?? 'execution_failed', type: 'server_error' },
      };
      res.write(`data: ${JSON.stringify(errPayload)}\n\n`);
    }
  }

  if (!clientDisconnected) {
    res.end();
  }
}
