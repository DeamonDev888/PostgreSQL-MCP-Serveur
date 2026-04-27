import axios from "axios";
import Logger from "../utils/logger.js";

/**
 * Service de génération d'embeddings pour production
 * Supporte OpenAI/OpenRouter API
 */
export class EmbeddingService {
  private apiKey: string | null = null;
  private baseURL: string = "https://openrouter.ai/api/v1";
  private modelName: string = "qwen/qwen3-embedding-8b";

  private cache: Map<string, number[]> = new Map();
  private maxCacheSize = 1000;

  private static MODEL_DIMENSIONS: Record<string, number> = {
    "qwen/qwen3-embedding-8b": 4096,
    "text-embedding-3-small": 1536,
    "text-embedding-ada-002": 1536,
    "text-embedding-3-large": 3072,
  };

  getDimensionsForModel(model?: string): number {
    const m = model || this.modelName;
    for (const [key, dims] of Object.entries(
      EmbeddingService.MODEL_DIMENSIONS,
    )) {
      if (m.includes(key) || key.includes(m)) return dims;
    }
    return 1536;
  }

  constructor(config?: { apiKey?: string; baseURL?: string; model?: string }) {
    // Priority:
    // 1. Programmatic config
    // 2. OVERMIND_EMBEDDING_KEY (Workflow variable)
    // 3. OPENROUTER_API_KEY (official spelling)
    // 4. OPEN_ROUTER_API_KEY (legacy)
    const openRouterKey =
      config?.apiKey ||
      process.env.OVERMIND_EMBEDDING_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.OPEN_ROUTER_API_KEY;

    const customURL = config?.baseURL || process.env.OVERMIND_EMBEDDING_URL;
    const customModel = config?.model || process.env.OVERMIND_EMBEDDING_MODEL;

    if (openRouterKey) {
      this.apiKey = openRouterKey;
      if (customURL) this.baseURL = customURL;
      if (customModel) this.modelName = customModel;
      Logger.info(
        `✅ Embedding Service: Programmatic/OpenRouter Configured (Model: ${this.modelName})`,
      );
    } else if (process.env.OPENAI_API_KEY) {
      this.apiKey = process.env.OPENAI_API_KEY;
      this.baseURL = "https://api.openai.com/v1";
      this.modelName = "text-embedding-3-small";
      Logger.info("✅ Embedding Service: OpenAI API Configured (Fallback)");
    } else {
      const allKeys = Object.keys(process.env).filter((k) => k.includes("API"));
      Logger.warn(
        `⚠️ Embedding Service: NO API KEY - MOCK MODE ACTIVE. Keys found: ${allKeys.join(", ")}`,
      );
    }
  }

  /**
   * Génère un embedding à partir d'un texte
   * @param text - Texte à transformer en vecteur
   * @param options - Options de génération
   * @returns Promise<number[]>
   */
  async generateEmbedding(
    text: string,
    options: {
      model?: string;
      useCache?: boolean;
      dimensions?: number;
    } = {},
  ): Promise<number[]> {
    const {
      model = this.modelName,
      useCache = true,
      dimensions = this.getDimensionsForModel(),
    } = options;

    // 0. Nettoyer
    const normalizedText = text.trim();
    if (!normalizedText) return new Array(dimensions).fill(0);

    // 1. Cache Check
    const cacheKey = `${model}:${normalizedText}`;
    if (useCache && this.cache.has(cacheKey)) {
      Logger.debug(`📦 Embedding Cache Hit`);
      return this.cache.get(cacheKey)!;
    }

    try {
      if (this.apiKey) {
        // REAL API CALL
        const embedding = await this.generateWithAPI(normalizedText, model);

        // Cache
        if (useCache) this.addToCache(cacheKey, embedding);
        return embedding;
      } else {
        throw new Error(
          "❌ CRITICAL: No API Configuration found. Mock mode is disabled. Please set OPENROUTER_API_KEY, OPEN_ROUTER_API_KEY, or OVERMIND_EMBEDDING_KEY in .env",
        );
      }
    } catch (error: any) {
      Logger.error(`❌ Embedding Gen Failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Appelle l'API OpenRouter/OpenAI pour générer l'embedding
   */
  private async generateWithAPI(
    text: string,
    model: string,
    retries: number = 3,
  ): Promise<number[]> {
    const baseDelay = 1000;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.post(
          `${this.baseURL}/embeddings`,
          {
            model: model,
            input: text,
            encoding_format: "float",
          },
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://sentinel-bot.local",
              "X-Title": "Sentinel Market AI",
            },
            timeout: 30000,
          },
        );

        if (
          response.data &&
          response.data.data &&
          response.data.data.length > 0
        ) {
          const vec = response.data.data[0].embedding;
          Logger.debug(
            `✅ API Embedding: ${vec.length} dims (Model: ${model})`,
          );
          return vec;
        } else {
          throw new Error(
            "Invalid API Response format: No embedding data found",
          );
        }
      } catch (err: any) {
        const msg = err.response?.data?.error?.message || err.message;
        if (
          attempt < retries &&
          (err.code === "ECONNABORTED" || err.response?.status >= 500)
        ) {
          const delay = baseDelay * attempt;
          Logger.warn(
            `⏳ Embedding API retry ${attempt}/${retries} after ${delay}ms: ${msg}`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        Logger.error(
          `API Error details: ${JSON.stringify(err.response?.data || {})}`,
        );
        throw new Error(`API Error: ${msg}`);
      }
    }
    throw new Error("API Error: max retries exceeded");
  }

  // Disabled Mock Embedding
  // private generateMockEmbedding(dimensions: number): number[] { ... }

  private addToCache(key: string, embedding: number[]): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, embedding);
  }

  clearCache(): void {
    this.cache.clear();
    Logger.info("🧹 Cache vidé");
  }

  getModelName(): string {
    return this.modelName;
  }

  async benchmark(_texts: string[]): Promise<any> {
    // ... (Benchmark kept simple)
    return { averageTime: 0, totalTime: 0, successRate: 0 };
  }
}

let _embeddingService: EmbeddingService | null = null;

export function getEmbeddingService(): EmbeddingService {
  if (!_embeddingService) {
    _embeddingService = new EmbeddingService();
  }
  return _embeddingService;
}

export const embeddingService = new Proxy({} as EmbeddingService, {
  get(_, prop) {
    return (getEmbeddingService() as any)[prop];
  },
});

/**
 * Drop-in helper for OverMind Memory refactoring.
 */
export async function embedText(
  text: string,
): Promise<{ embedding: number[]; model: string }> {
  try {
    const embedding = await embeddingService.generateEmbedding(text);
    return { embedding, model: embeddingService.getModelName() };
  } catch (error: any) {
    Logger.error(`❌ embedText failed: ${error.message}`);
    throw error;
  }
}
