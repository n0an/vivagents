// Copyright © 2026 Anton Novoselov. All rights reserved.

/**
 * Map vendor-style provider names (what iOS clients send) to vivagents' internal
 * CLI-based provider names.
 *
 * Rationale: iOS has its own AIProvider enum (anthropic, openai, google, etc.),
 * but vivagents names providers after the CLI binary it spawns (claude, codex, gemini).
 * Clients shouldn't have to know this implementation detail.
 */
const ALIASES: Record<string, string> = {
  anthropic: 'claude',
  claude: 'claude',
  openai: 'codex',
  'openai-codex': 'codex',
  codex: 'codex',
  google: 'gemini',
  'google-ai': 'gemini',
  gemini: 'gemini',
};

/**
 * Resolve an incoming provider name to its canonical vivagents provider.
 * Returns the canonical name if known, otherwise returns the input unchanged
 * (so the caller can still produce an "Unknown provider" error).
 */
export function resolveProviderAlias(name: string | undefined | null): string {
  if (!name || typeof name !== 'string') return 'claude';
  const key = name.trim().toLowerCase();
  return ALIASES[key] ?? key;
}
