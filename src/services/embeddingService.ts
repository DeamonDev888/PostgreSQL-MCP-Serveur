import axios from 'axios';
import Logger from '../utils/logger.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Gestion __dirname pour ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Charger .env explicitement pour être sûr
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Service de génération d'embeddings pour production
 * Supporte OpenAI/OpenRouter API
 */
export class EmbeddingService {
  private apiKey: string | null = null;
  private baseURL: string = 'https://openrouter.ai/api/v1';
  private modelName: string = 'qwen/qwen3-embedding-8b'; 
  
  private cache: Map<string, number[]> = new Map();
  private maxCacheSize = 1000;

  constructor() {
    // Debug Paths and Env
    Logger.debug(`📂 CWD: ${process.cwd()}`);
    Logger.debug(`📂 Service Dir: ${__dirname}`);
    
    // Initialiser OpenRouter API si clé disponible
    const openRouterKey = process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_API_KEY;

    if (openRouterKey) {
      this.apiKey = openRouterKey;
      Logger.info(`✅ Embedding Service: OpenRouter API Configured (Key len: ${this.apiKey.length})`);
    } else if (process.env.OPENAI_API_KEY) {
        this.apiKey = process.env.OPENAI_API_KEY;
        this.baseURL = 'https://api.openai.com/v1';
        this.modelName = 'text-embedding-3-small';
        Logger.info('✅ Embedding Service: OpenAI API Configured (Fallback)');
    } else {
      const allKeys = Object.keys(process.env).filter(k => k.includes('API'));
      Logger.warn(`⚠️ Embedding Service: NO API KEY - MOCK MODE ACTIVE. Keys found: ${allKeys.join(', ')}`);
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
    } = {}
  ): Promise<number[]> {
    const {
      model = this.modelName,
      useCache = true,
      dimensions = 1536 
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
          throw new Error("❌ CRITICAL: No API Configuration found. Mock mode is disabled. Please set OPEN_ROUTER_API_KEY in .env");
      }

    } catch (error: any) {
      Logger.error(`❌ Embedding Gen Failed: ${error.message}`);
      throw error; 
    }
  }

  /**
   * Appelle l'API OpenRouter/OpenAI pour générer l'embedding
   */
  private async generateWithAPI(text: string, model: string): Promise<number[]> {
      try {
        const response = await axios.post(
            `${this.baseURL}/embeddings`,
            {
                model: model,
                input: text,
                encoding_format: "float"
            },
            {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    // OpenRouter specific headers
                    'HTTP-Referer': 'https://sentinel-bot.local', 
                    'X-Title': 'Sentinel Market AI'
                },
                timeout: 15000 // Increased timeout for Qwen
            }
        );

        if (response.data && response.data.data && response.data.data.length > 0) {
            const vec = response.data.data[0].embedding;
            Logger.debug(`✅ API Embedding: ${vec.length} dims (Model: ${model})`);
            return vec;
        } else {
            throw new Error('Invalid API Response format: No embedding data found');
        }
      } catch (err: any) {
          const msg = err.response?.data?.error?.message || err.message;
          Logger.error(`API Error details: ${JSON.stringify(err.response?.data || {})}`);
          throw new Error(`API Error: ${msg}`);
      }
  }

  // Disabled Mock Embedding
  // private generateMockEmbedding(dimensions: number): number[] { ... }

  private addToCache(key: string, embedding: number[]): void {
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, embedding);
  }

  clearCache(): void {
    this.cache.clear();
    Logger.info('🧹 Cache vidé');
  }

  async benchmark(_texts: string[]): Promise<any> {
     // ... (Benchmark kept simple)
     return { averageTime: 0, totalTime: 0, successRate: 0 }; 
  }
}

export const embeddingService = new EmbeddingService();
