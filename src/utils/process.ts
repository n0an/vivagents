// Copyright © 2026 Anton Novoselov. All rights reserved.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function spawnCLI(
  binaryPath: string,
  args: string[],
  env: Record<string, string | undefined>,
  timeout: number
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      reject(err);
    });

    proc.on('close', (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
      });
    });
  });
}

/**
 * Spawn a CLI with a string piped to stdin.
 * Needed for chat-completions where the flattened prompt can exceed ARG_MAX.
 */
export function spawnCLIWithStdin(
  binaryPath: string,
  args: string[],
  stdinInput: string,
  env: Record<string, string | undefined>,
  timeout: number
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      reject(err);
    });

    proc.on('close', (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
      });
    });

    proc.stdin.on('error', () => {
      // Ignore stdin errors - the child may close stdin early
    });
    proc.stdin.write(stdinInput);
    proc.stdin.end();
  });
}

/**
 * Spawn a CLI with stdin piping and line-by-line stdout streaming.
 * Each complete stdout line is delivered via onLine(). Resolves on process close.
 * Used for --output-format stream-json where events are newline-delimited JSON.
 */
export interface StreamingSpawnOptions {
  onLine: (line: string) => void;
  abortSignal?: AbortSignal;
}

export function spawnCLIStreaming(
  binaryPath: string,
  args: string[],
  stdinInput: string,
  env: Record<string, string | undefined>,
  timeout: number,
  opts: StreamingSpawnOptions
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const proc: ChildProcessWithoutNullStreams = spawn(binaryPath, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
    });

    const killTimers: NodeJS.Timeout[] = [];
    const killProc = () => {
      try { proc.kill('SIGTERM'); } catch { /* noop */ }
      killTimers.push(setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* noop */ }
      }, 5000));
    };

    if (opts.abortSignal) {
      if (opts.abortSignal.aborted) killProc();
      opts.abortSignal.addEventListener('abort', killProc, { once: true });
    }

    let stdoutBuf = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdoutBuf += data.toString();
      let nl: number;
      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, nl);
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (line.trim()) opts.onLine(line);
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      killTimers.forEach(clearTimeout);
      reject(err);
    });

    proc.on('close', (code) => {
      killTimers.forEach(clearTimeout);
      // Flush any remaining buffered line
      if (stdoutBuf.trim()) opts.onLine(stdoutBuf);
      resolve({
        stdout: '',
        stderr: stderr.trim(),
        exitCode: code ?? 1,
      });
    });

    proc.stdin.on('error', () => { /* ignore */ });
    proc.stdin.write(stdinInput);
    proc.stdin.end();
  });
}
