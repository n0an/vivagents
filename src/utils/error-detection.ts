// Copyright © 2026 Anton Novoselov. All rights reserved.

export interface CLIError {
  code: string;
  status: number;
  message: string;
}

export function detectError(stderr: string, exitCode: number, stdout: string): CLIError | null {
  const lower = stderr.toLowerCase();

  if (/login|not logged in|authenticate|not authenticated/.test(lower)) {
    return { code: 'NOT_AUTHENTICATED', status: 401, message: 'CLI is not authenticated. Run the CLI tool manually to log in.' };
  }

  if (/rate limit|too many requests|overloaded|quota|resource_exhausted/.test(lower)) {
    return { code: 'RATE_LIMITED', status: 429, message: 'Rate limit reached. Try again later.' };
  }

  if (exitCode !== 0) {
    return { code: 'EXECUTION_FAILED', status: 500, message: stderr || `CLI exited with code ${exitCode}` };
  }

  if (exitCode === 0 && !stdout.trim()) {
    return { code: 'EMPTY_RESPONSE', status: 500, message: 'CLI returned empty output' };
  }

  return null;
}
