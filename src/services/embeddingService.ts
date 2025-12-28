#!/usr/bin/env node

// import { OpenAI } from 'openai';
// import { pipeline } from '@xenova/transformers';
import Logger from '../utils/logger.js';

/**
 * Service de génération d'embeddings pour production
 * Supporte OpenAI API (1536 dims) et modèles locaux
 */
export class EmbeddingService {
  // private openai: OpenAI | null = null;
  // private localExtractor: any = null;
  private cache: Map<string, number[]> = new Map();
  private maxCacheSize = 1000;

  constructor() {
    // Initialiser OpenAI si clé disponible
    // if (process.env.OPENAI_API_KEY) {
    //   this.openai = new OpenAI({
    //     apiKey: process.env.OPENAI_API_KEY,
    //   });
    //   Logger.info('✅ OpenAI embedding service initialisé');
    // } else {
    //   Logger.warn('⚠️ OPENAI_API_KEY non trouvé - utilisation du mode local uniquement');
    // }
    Logger.warn('⚠️ EmbeddingService - Mode mock (OpenAI et transformers non installés)');
  }

  /**
   * Génère un embedding à partir d'un texte
   * @param text - Texte à transformer en vecteur
   * @param options - Options de génération
   * @returns Promise<number[]> - Vecteur de 768 nombres
   */
  async generateEmbedding(
    text: string,
    options: {
      model?: 'openai' | 'local';
      useCache?: boolean;
      dimensions?: number;
    } = {}
  ): Promise<number[]> {
    const {
      model = 'local', // this.openai ? 'openai' : 'local',
      useCache = true,
      dimensions = 1536
    } = options;

    // Nettoyer et normaliser le texte
    const normalizedText = text.trim().toLowerCase();

    // Vérifier le cache
    const cacheKey = `${model}:${normalizedText}`;
    if (useCache && this.cache.has(cacheKey)) {
      Logger.debug(`📦 Embedding récupéré du cache pour: "${text.substring(0, 50)}..."`);
      return this.cache.get(cacheKey)!;
    }

    try {
      let embedding: number[];

      // Mode mock - générer un vecteur aléatoire pour les tests
      Logger.warn(`⚠️ Mode mock - génération vecteur aléatoire pour: "${text.substring(0, 30)}..."`);
      embedding = this.generateMockEmbedding(dimensions);

      // Vérifier les dimensions
      if (embedding.length !== dimensions) {
        throw new Error(`Dimension mismatch: expected ${dimensions}, got ${embedding.length}`);
      }

      // Ajouter au cache
      if (useCache) {
        this.addToCache(cacheKey, embedding);
      }

      Logger.debug(`✅ Embedding généré (${model}): ${embedding.length} dimensions`);
      return embedding;

    } catch (error: any) {
      Logger.error('❌ Erreur génération embedding:', error.message);
      throw new Error(`Échec de génération d'embedding: ${error.message}`);
    }
  }

  /**
   * Génère un embedding mock (aléatoire) pour les tests
   */
  private generateMockEmbedding(dimensions: number): number[] {
    const embedding: number[] = [];
    for (let i = 0; i < dimensions; i++) {
      embedding.push((Math.random() * 2) - 1);
    }
    // Normaliser
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / magnitude);
  }

  // /**
  //  * Génère un embedding via OpenAI
  //  */
  // private async generateWithOpenAI(text: string): Promise<number[]> {
  //   if (!this.openai) {
  //     throw new Error('OpenAI non initialisé');
  //   }

  //   const response = await this.openai.embeddings.create({
  //     model: 'text-embedding-3-small', // 768 dimensions
  //     input: text,
  //   });

  //   return response.data[0].embedding;
  // }

  // /**
  //  * Génère un embedding via modèle local
  //  */
  // private async generateWithLocal(text: string): Promise<number[]> {
  //   if (!this.localExtractor) {
  //     Logger.info('🔄 Initialisation du modèle local (peut prendre du temps)...');
  //     this.localExtractor = await pipeline(
  //       'feature-extraction',
  //       'Xenova/all-mpnet-base-v2'
  //     );
  //     Logger.info('✅ Modèle local chargé');
  //   }

  //   const output = await this.localExtractor(text);
  //   return Array.from(output.data);
  // }

  /**
   * Ajoute un embedding au cache avec gestion de la taille
   */
  private addToCache(key: string, embedding: number[]): void {
    if (this.cache.size >= this.maxCacheSize) {
      // Supprimer l'entrée la plus ancienne
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
        Logger.debug('🗑️ Cache plein - entrée la plus ancienne supprimée');
      }
    }

    this.cache.set(key, embedding);
  }

  /**
   * Vide le cache
   */
  clearCache(): void {
    this.cache.clear();
    Logger.info('🧹 Cache d\'embeddings vidé');
  }

  /**
   * Statistiques du cache
   */
  getCacheStats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
    };
  }

  /**
   * Test de performance du service
   */
  async benchmark(texts: string[]): Promise<{
    averageTime: number;
    totalTime: number;
    successRate: number;
  }> {
    Logger.info(`🧪 Benchmark sur ${texts.length} textes...`);

    const startTime = Date.now();
    let successCount = 0;

    for (const text of texts) {
      try {
        await this.generateEmbedding(text);
        successCount++;
      } catch (error) {
        Logger.error(`❌ Échec pour: "${text.substring(0, 30)}..."`);
      }
    }

    const totalTime = Date.now() - startTime;
    const averageTime = totalTime / texts.length;
    const successRate = (successCount / texts.length) * 100;

    Logger.info(`✅ Benchmark terminé:`);
    Logger.info(`   • Temps moyen: ${averageTime.toFixed(2)}ms`);
    Logger.info(`   • Taux de succès: ${successRate.toFixed(1)}%`);

    return {
      averageTime,
      totalTime,
      successRate,
    };
  }
}

// Export singleton
export const embeddingService = new EmbeddingService();
