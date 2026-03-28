// Copyright © 2026 Anton Novoselov. All rights reserved.

export interface CLIError {
  code: string;
  status: number;
  message: string;
}

export function detectError(stderr: string, exitCode: number, stdout: string): CLIError | null {
  const lower = stderr.toLowerCase();

  // Authentication errors
  if (/login|not logged in|authenticate|not authenticated|refresh token|token_expired|sign in again|api.?key|unauthorized/.test(lower)) {
    return { code: 'NOT_AUTHENTICATED', status: 401, message: 'CLI session expired or not authenticated. Please re-authenticate the CLI tool on the server.' };
  }

  // Rate limiting
  if (/rate limit|too many requests|overloaded|quota|resource_exhausted/.test(lower)) {
    return { code: 'RATE_LIMITED', status: 429, message: 'Rate limit reached. Try again later.' };
  }

  // Generic failure — clean up the message
  if (exitCode !== 0) {
    return { code: 'EXECUTION_FAILED', status: 500, message: sanitizeErrorMessage(stderr, exitCode) };
  }

  // Empty response
  if (exitCode === 0 && !stdout.trim()) {
    return { code: 'EMPTY_RESPONSE', status: 500, message: 'CLI returned empty output.' };
  }

  return null;
}

/**
 * Extract a human-readable error message from raw CLI stderr output.
 * Strips timestamps, log prefixes, JSON blobs, and repeated lines.
 */
function sanitizeErrorMessage(stderr: string, exitCode: number): string {
  if (!stderr) return `CLI exited with code ${exitCode}`;

  const lines = stderr.split('\n');

  // Try to find the most meaningful line (ERROR: prefix, or last non-empty line)
  const errorLine = lines.find(l => /^ERROR:/i.test(l.trim()))
    ?? lines.find(l => l.trim().length > 0 && !l.trim().startsWith('{') && !l.trim().startsWith('"'));

  if (errorLine) {
    // Strip timestamp prefixes like "2026-03-28T12:17:32.322119Z ERROR codex_core::auth: "
    const cleaned = errorLine
      .replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+/g, '')
      .replace(/^ERROR\s+[\w:]+:\s*/gi, '')
      .replace(/^ERROR:\s*/gi, '')
      .trim();

    if (cleaned.length > 10) {
      return cleaned.length > 200 ? cleaned.slice(0, 200) + '...' : cleaned;
    }
  }

  // Fallback: truncate raw stderr
  const truncated = stderr.slice(0, 200).trim();
  return truncated + (stderr.length > 200 ? '...' : '');
}
