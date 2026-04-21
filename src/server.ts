// Copyright © 2026 Anton Novoselov. All rights reserved.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { CLIProvider } from './providers/types.js';
import { handleHealth } from './routes/health.js';
import { handleModels } from './routes/models.js';
import { handleEnhance } from './routes/enhance.js';
import {
  handleChatCompletionsNonStream,
  handleChatCompletionsStream,
} from './routes/chatCompletions.js';
import { logger } from './logger.js';

function sendJSON(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Connection': 'close',
  });
  res.end(json);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function checkAuth(req: IncomingMessage, body: Record<string, unknown> | null, token: string): boolean {
  if (!token) return true;

  // Check Authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (bearerToken === token) return true;
  }

  // Check token in JSON body
  if (body && typeof body['token'] === 'string' && body['token'] === token) {
    return true;
  }

  return false;
}

export function startServer(
  port: number,
  host: string,
  token: string,
  providers: Map<string, CLIProvider>
): void {
  const server = createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url?.split('?')[0] ?? '/';

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      sendJSON(res, 204, {});
      return;
    }

    // Read body for POST requests
    let bodyString = '';
    let bodyJSON: Record<string, unknown> | null = null;

    if (method === 'POST') {
      try {
        bodyString = await readBody(req);
        bodyJSON = JSON.parse(bodyString) as Record<string, unknown>;
      } catch {
        sendJSON(res, 400, { error: 'Invalid JSON body', code: 'INVALID_REQUEST' });
        return;
      }
    }

    // Auth check
    if (!checkAuth(req, bodyJSON, token)) {
      sendJSON(res, 403, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
      return;
    }

    // Route
    switch (`${method} ${url}`) {
      case 'GET /health': {
        sendJSON(res, 200, handleHealth(providers));
        break;
      }

      case 'GET /models': {
        sendJSON(res, 200, handleModels(providers));
        break;
      }

      case 'POST /process': {
        const result = await handleEnhance(
          bodyJSON as { text: string; systemPrompt?: string; model?: string; provider?: string },
          providers
        );
        sendJSON(res, result.status, result.body as unknown as Record<string, unknown>);
        break;
      }

      case 'POST /v1/chat/completions': {
        const chatBody = (bodyJSON ?? {}) as Record<string, unknown>;
        const streamRequested = chatBody['stream'] === true;

        if (streamRequested) {
          // Streaming path takes over the response lifecycle.
          await handleChatCompletionsStream(chatBody, providers, res);
        } else {
          const result = await handleChatCompletionsNonStream(chatBody, providers);
          sendJSON(res, result.status, result.body);
        }
        break;
      }

      default: {
        sendJSON(res, 404, { error: 'Not found' });
      }
    }
  });

  server.listen(port, host, () => {
    logger.info(`VivAgents server running on http://${host}:${port}`);
    logger.info(`Auth token: ${token.slice(0, 8)}...`);

    // Show available providers
    for (const [name, provider] of providers) {
      const status = provider.isAvailable ? '✓' : '✗';
      logger.info(`  ${status} ${provider.displayName}${provider.binaryPath ? ` (${provider.binaryPath})` : ''}`);
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
