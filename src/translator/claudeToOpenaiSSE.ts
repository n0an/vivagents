// Copyright © 2026 Anton Novoselov. All rights reserved.

/**
 * Parse a line of Claude's --output-format stream-json output and emit zero or more
 * OpenAI-format SSE chunks that can be written directly to the client.
 *
 * Claude's stream-json emits newline-delimited JSON events of various shapes.
 * We only translate text-producing events:
 *   - type "assistant" with content blocks containing { type: "text", text: "..." }
 *   - type "result" → emits the final {finish_reason:"stop"} chunk + [DONE]
 *
 * Everything else (tool_use events, thinking blocks, system metadata) is silently
 * dropped because the iOS client doesn't need it for a text-only chat response.
 *
 * The exact stream-json schema is not formally stable; this parser is defensive
 * and should no-op on unknown shapes rather than crash.
 */

export interface ChunkContext {
  chatId: string;
  model: string;
}

export function* streamJsonLineToOpenAISSE(
  line: string,
  ctx: ChunkContext
): Generator<string> {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  if (!event || typeof event !== 'object') return;
  const e = event as Record<string, unknown>;
  const type = typeof e['type'] === 'string' ? (e['type'] as string) : '';

  // Text deltas: "assistant" messages carry a content[] array with text blocks.
  if (type === 'assistant') {
    const msg = e['message'] as Record<string, unknown> | undefined;
    const content = msg && Array.isArray(msg['content']) ? (msg['content'] as unknown[]) : null;
    if (!content) return;

    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b['type'] === 'text' && typeof b['text'] === 'string' && b['text'].length > 0) {
        yield buildSSE(ctx, { content: b['text'] as string }, null);
      }
    }
    return;
  }

  // Final result: emit stop chunk + [DONE] sentinel.
  if (type === 'result') {
    yield buildSSE(ctx, {}, 'stop');
    yield `data: [DONE]\n\n`;
    return;
  }
}

/**
 * Build a single OpenAI-format SSE chunk (including the "data: " prefix and \n\n terminator).
 */
function buildSSE(
  ctx: ChunkContext,
  delta: { content?: string; role?: string },
  finishReason: string | null
): string {
  const chunk = {
    id: ctx.chatId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: ctx.model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * First chunk of any stream - tells the OpenAI client the assistant role is starting.
 * Many OpenAI-compatible clients (including the iOS app's Ollama path) expect this.
 */
export function buildRoleChunk(ctx: ChunkContext): string {
  const chunk = {
    id: ctx.chatId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: ctx.model,
    choices: [
      {
        index: 0,
        delta: { role: 'assistant' },
        finish_reason: null,
      },
    ],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}
