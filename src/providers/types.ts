// Copyright © 2026 Anton Novoselov. All rights reserved.

export interface EnhanceParams {
  text: string;
  systemPrompt: string;
  model: string;
}

export interface CLIProvider {
  readonly name: string;
  readonly displayName: string;
  readonly models: string[];
  readonly defaultModel: string;
  isAvailable: boolean;
  binaryPath: string | null;

  findBinary(): string | null;
  enhance(params: EnhanceParams): Promise<string>;
}
