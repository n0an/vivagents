// Copyright © 2026 Anton Novoselov. All rights reserved.

import type { CLIProvider } from '../providers/types.js';

export function handleModels(providers: Map<string, CLIProvider>): Record<string, unknown> {
  const claude = providers.get('claude');
  const codex = providers.get('codex');
  const gemini = providers.get('gemini');

  return {
    models: claude?.models ?? [],
    default: claude?.defaultModel ?? '',
    codex_models: codex?.models ?? [],
    codex_default: codex?.defaultModel ?? '',
    gemini_models: gemini?.models ?? [],
    gemini_default: gemini?.defaultModel ?? '',
  };
}
