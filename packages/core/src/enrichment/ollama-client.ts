import { ok, err, type Result } from 'neverthrow';

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  timeout: number;
  /** Maximum tokens to generate per request (Ollama num_predict). 0 = unlimited. */
  maxTokens: number;
}

const DEFAULT_CONFIG: OllamaConfig = {
  baseUrl: 'http://localhost:11434',
  model: 'qwen2.5-coder:7b',
  timeout: 30_000,
  maxTokens: 100,
};

export class OllamaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OllamaError';
  }
}

interface OllamaGenerateResponse {
  response: string;
}

export class OllamaClient {
  private readonly config: OllamaConfig;

  constructor(config?: Partial<OllamaConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get currentConfig(): OllamaConfig {
    return { ...this.config };
  }

  async generate(prompt: string): Promise<Result<string, OllamaError>> {
    try {
      const response = await globalThis.fetch(
        `${this.config.baseUrl}/api/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.config.model,
            prompt,
            stream: false,
            ...(this.config.maxTokens > 0 ? { options: { num_predict: this.config.maxTokens } } : {}),
          }),
          signal: AbortSignal.timeout(this.config.timeout),
        },
      );

      if (!response.ok) {
        return err(
          new OllamaError(
            `Ollama API returned status ${response.status}: ${response.statusText}`,
          ),
        );
      }

      const data = (await response.json()) as OllamaGenerateResponse;
      return ok(data.response);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return err(new OllamaError(`Ollama request failed: ${message}`));
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await globalThis.fetch(
        `${this.config.baseUrl}/api/tags`,
        { signal: AbortSignal.timeout(this.config.timeout) },
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}
