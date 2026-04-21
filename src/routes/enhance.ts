// Copyright © 2026 Anton Novoselov. All rights reserved.

import type { CLIProvider } from '../providers/types.js';
import { resolveProviderAlias } from '../providers/aliases.js';
import { logger } from '../logger.js';

interface EnhanceRequest {
  text: string;
  systemPrompt?: string;
  model?: string;
  provider?: string;
}

interface EnhanceResponse {
  result: string;
  model: string;
  provider: string;
  duration: number;
}

interface ErrorResponse {
  error: string;
  code: string;
}

export async function handleEnhance(
  body: EnhanceRequest,
  providers: Map<string, CLIProvider>
): Promise<{ status: number; body: EnhanceResponse | ErrorResponse }> {
  const { text, systemPrompt = '', provider: rawProvider = 'claude' } = body;
  const providerName = resolveProviderAlias(rawProvider);

  if (!text || typeof text !== 'string' || !text.trim()) {
    return { status: 400, body: { error: "Missing 'text' field", code: 'INVALID_REQUEST' } };
  }

  const providerInstance = providers.get(providerName);
  if (!providerInstance) {
    return { status: 400, body: { error: `Unknown provider: ${providerName}`, code: 'INVALID_REQUEST' } };
  }

  if (!providerInstance.isAvailable) {
    return { status: 500, body: { error: `${providerInstance.displayName} is not available`, code: 'BINARY_NOT_FOUND' } };
  }

  const model = body.model || providerInstance.defaultModel;

  logger.info(`/process request: provider=${providerName}, model=${model}, textLength=${text.length}`);

  const startTime = Date.now();

  try {
    const result = await providerInstance.enhance({ text, systemPrompt, model });
    const duration = Math.round((Date.now() - startTime) / 10) / 100;

    logger.info(`/process success: provider=${providerName}, model=${model}, resultLength=${result.length}, duration=${duration}s`);

    return {
      status: 200,
      body: { result, model, provider: providerName, duration },
    };
  } catch (err: unknown) {
    const duration = Math.round((Date.now() - startTime) / 10) / 100;
    const error = err as Error & { code?: string; status?: number };
    const code = error.code ?? 'EXECUTION_FAILED';
    const status = error.status ?? 500;

    logger.error(`/process FAILED: provider=${providerName}, code=${code}, duration=${duration}s, error=${error.message}`);

    return {
      status,
      body: { error: error.message, code },
    };
  }
}
