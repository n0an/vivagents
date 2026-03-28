// Copyright © 2026 Anton Novoselov. All rights reserved.

import type { CLIProvider } from '../providers/types.js';

export function handleHealth(providers: Map<string, CLIProvider>): Record<string, unknown> {
  const claude = providers.get('claude');
  const codex = providers.get('codex');
  const gemini = providers.get('gemini');

  return {
    status: 'ok',
    claude_available: claude?.isAvailable ?? false,
    claude_path: claude?.binaryPath ?? '',
    codex_available: codex?.isAvailable ?? false,
    codex_path: codex?.binaryPath ?? '',
    gemini_available: gemini?.isAvailable ?? false,
    gemini_path: gemini?.binaryPath ?? '',
    version: '1.0.0',
  };
}
