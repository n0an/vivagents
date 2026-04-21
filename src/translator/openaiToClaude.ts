// Copyright © 2026 Anton Novoselov. All rights reserved.

export type OpenAIRole = 'system' | 'user' | 'assistant';

export interface OpenAIMessage {
  role: OpenAIRole;
  content: string;
}

export interface FlattenedPrompt {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Flatten an OpenAI-style messages[] array into:
 *   - systemPrompt: concatenation of all role=system messages (passed to --append-system-prompt)
 *   - userPrompt:   the conversation as a transcript ("User: ...\n\nAssistant: ...") piped via stdin
 *
 * Rationale: the Claude CLI is session-based (--resume), but the VivaDicta iOS client is
 * stateless - it owns conversation history locally and re-sends the full messages[] every turn.
 * So we treat each HTTP request as a one-shot: flatten the whole history into a single prompt
 * and spawn a fresh claude --print. Each request reprocesses full context (cost scales with
 * turn count) but keeps the API simple and matches how iOS expects to call OpenAI-compat
 * backends like Ollama.
 */
export function openaiMessagesToPrompt(messages: OpenAIMessage[]): FlattenedPrompt {
  const systemParts: string[] = [];
  const lines: string[] = [];

  for (const m of messages) {
    if (!m || typeof m.content !== 'string') continue;
    const content = m.content.trim();
    if (!content) continue;

    if (m.role === 'system') {
      systemParts.push(content);
    } else if (m.role === 'user') {
      lines.push(`User: ${content}`);
    } else if (m.role === 'assistant') {
      lines.push(`Assistant: ${content}`);
    }
  }

  return {
    systemPrompt: systemParts.join('\n\n'),
    userPrompt: lines.join('\n\n'),
  };
}
