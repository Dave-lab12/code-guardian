export interface AppConfig {
  paths: {
    codebaseRoot: string;
    chunksDir: string;
    schemaFile: string;
    embeddingsFile: string;
    promptsDir: string;
    tempDir: string;

  };
  parsing: {
    supportedFileTypes: string[];
  };
  embedding: {
    model: string;
    batchSize: number;
    rateLimitDelay: number;
  };
}

export class Config {
  private static instance: Config;
  private config: AppConfig;

  private constructor() {
    this.config = {
      paths: {
        codebaseRoot: process.env.CODEBASE_ROOT || process.cwd(),
        chunksDir: process.env.CHUNKS_DIR || 'contents/mindplex-chunks',
        schemaFile: process.env.SCHEMA_FILE || 'schema.json',
        embeddingsFile: process.env.EMBEDDINGS_FILE || 'embeddings.json',
        promptsDir: process.env.PROMPTS_DIR || 'src/prompts',
        tempDir: process.env.TEMP_DIR || process.env.RUNNER_TEMP || '/tmp'

      },
      parsing: {
        supportedFileTypes: ['ts', 'svelte', 'js', 'json', 'css', 'html', 'md', 'txt', 'yml']
      },
      embedding: {
        model: 'text-embedding-3-small',
        batchSize: 100,
        rateLimitDelay: 1000
      }
    };
  }

  static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }

  get(): AppConfig {
    return this.config;
  }

  getPath(key: keyof AppConfig['paths']): string {
    return this.config.paths[key];
  }

  getFullPath(...segments: string[]): string {
    return segments.join('/').replace(/\/+/g, '/');
  }
}
