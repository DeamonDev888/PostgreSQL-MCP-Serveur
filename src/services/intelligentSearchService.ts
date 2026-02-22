#!/usr/bin/env node

import { Pool } from 'pg';
import Logger from '../utils/logger.js';
import { embeddingService } from './embeddingService.js';
import { HybridSearchService } from './hybridSearchService.js';

/**
 * Service de recherche intelligent
 * Détecte automatiquement le mode optimal et route les requêtes
 */
export class IntelligentSearchService {
  private pool: Pool;
  private hybridSearch: HybridSearchService;

  constructor(pool: Pool) {
    this.pool = pool;
    this.hybridSearch = new HybridSearchService(pool);
  }

  /**
   * Point d'entrée principal - Recherche intelligente
   */
  async search(
    query: string,
    options: {
      tableName?: string;
      mode?: 'auto' | 'hybrid' | 'vector' | 'text';
      topK?: number;
      enableCache?: boolean;
      contentColumn?: string;
    } = {}
  ): Promise<{
    results: any[];
    metadata: {
      query: string;
      detectedMode: string;
      actualMode: string;
      executionTime: number;
      embeddingGenerated: boolean;
      cacheHit: boolean;
    };
  }> {
    const {
      tableName = 'documents',
      mode = 'auto',
      topK = 10,
      enableCache = true,
      contentColumn = 'content'
    } = options;

    const startTime = Date.now();

    try {
      // ÉTAPE 1: Détecter le mode optimal
      const detectedMode = this.detectSearchMode(query, mode);
      Logger.debug(`🎯 Mode détecté: ${detectedMode} pour: "${query.substring(0, 50)}..."`);

      // ÉTAPE 2: Exécuter la recherche selon le mode
      let results: any[] = [];
      let metadata: any = {
        query,
        detectedMode,
        actualMode: detectedMode,
        executionTime: 0,
        embeddingGenerated: false,
        cacheHit: false
      };

      switch (detectedMode) {
        case 'text': {
          const textResult = await this.hybridSearch.textSearch(query, tableName, contentColumn, topK);
          results = textResult.results;
          metadata = { ...metadata, ...textResult.metadata };
          break;
        }

        case 'vector': {
          const vectorResult = await this.performVectorSearch(query, tableName, topK, enableCache);
          results = vectorResult.results;
          // Si on est en mode vector, on n'a pas forcément accès à contentColumn dans le SELECT * 
          // sauf si c'est géré par "*" ou si l'utilisateur le spécifie dans RAG.
          metadata = {
            ...metadata,
            ...vectorResult.metadata,
            embeddingGenerated: true,
            cacheHit: vectorResult.fromCache
          };
          break;
        }

        case 'hybrid': {
          const hybridResult = await this.hybridSearch.search(query, {
            tableName,
            topK,
            hybridMode: true,
            useCache: enableCache,
            contentColumn
          });
          results = hybridResult.results;
          metadata = {
            ...metadata,
            ...hybridResult.metadata,
            embeddingGenerated: true
          };
          break;
        }

        default:
          throw new Error(`Mode non supporté: ${detectedMode}`);
      }

      metadata.executionTime = Date.now() - startTime;

      Logger.info(`✅ Recherche ${detectedMode} terminée: ${results.length} résultats en ${metadata.executionTime}ms`);

      return {
        results,
        metadata
      };

    } catch (error: any) {
      Logger.error('❌ Erreur recherche intelligente:', error.message);
      throw new Error(`Échec de recherche: ${error.message}`);
    }
  }

  /**
   * Détecte le mode optimal pour une requête
   */
  private detectSearchMode(userQuery: string, requestedMode: string): string {
    const query = userQuery.toLowerCase().trim();

    // Mode explicite demandé
    if (requestedMode !== 'auto') {
      return requestedMode;
    }

    // Mots-clés de test/debug - rediriger vers pgvector_search avec useRandomVector
    if (
      query.startsWith('test:') ||
      query.startsWith('debug:') ||
      query.startsWith('random:') ||
      query.includes('performance') ||
      query.includes('benchmark')
    ) {
      Logger.info('💡 Utilisez pgvector_search avec useRandomVector: true pour les tests');
      return 'text'; // Mode par défaut pour les tests dans intelligent_search
    }

    // Requête très courte - full-text suffisant
    if (query.split(' ').length <= 2) {
      return 'text';
    }

    // Requête complexe - hybride recommandé
    if (
      query.includes('comment') ||
      query.includes('pourquoi') ||
      query.includes('quelle est') ||
      query.length > 50
    ) {
      return 'hybrid';
    }

    // Par défaut: vecteur
    return 'vector';
  }

  /**
   * Recherche avec vecteur aléatoire
   */
  private async performRandomSearch(
    tableName: string,
    topK: number
  ): Promise<any[]> {
    const client = await this.pool.connect();

    try {
      // Générer un vecteur aléatoire 768D
      const randomVector = [];
      for (let i = 0; i < 768; i++) {
        randomVector.push((Math.random() * 2) - 1);
      }

      // Normaliser
      const magnitude = Math.sqrt(randomVector.reduce((sum, val) => sum + val * val, 0));
      const normalizedVector = randomVector.map(val => val / magnitude);

      // Recherche
      const results = await client.query(
        `
        SELECT *, 1 - (embedding <=> $1::vector) as similarity
        FROM ${tableName}
        ORDER BY embedding <=> $1::vector
        LIMIT $2
        `,
        [`[${normalizedVector.join(',')}]`, topK]
      );

      Logger.info('🎲 Recherche aléatoire effectuée');
      return results.rows;

    } finally {
      client.release();
    }
  }

  /**
   * Recherche vecteur seule
   */
  private async performVectorSearch(
    query: string,
    tableName: string,
    topK: number,
    useCache: boolean
  ): Promise<{ results: any[]; metadata: any; fromCache: boolean }> {
    const client = await this.pool.connect();

    try {
      // Générer l'embedding
      const embedding = await embeddingService.generateEmbedding(query, { useCache });

      // Vérifier si vient du cache
      const fromCache = false; // Note: Cette vérification pourrait être améliorée avec un cache LRU

      // Recherche
      const results = await client.query(
        `
        SELECT *, 1 - (embedding <=> $1::vector) as similarity
        FROM ${tableName}
        ORDER BY embedding <=> $1::vector
        LIMIT $2
        `,
        [`[${embedding.join(',')}]`, topK]
      );

      return {
        results: results.rows,
        metadata: {
          embeddingDimensions: embedding.length,
          queryLength: query.length
        },
        fromCache
      };

    } finally {
      client.release();
    }
  }

  /**
   * Analyse et suggère des optimisations
   */
  async analyzeQuery(query: string): Promise<{
    mode: string;
    confidence: number;
    reasoning: string[];
    suggestions: string[];
  }> {
    const mode = this.detectSearchMode(query, 'auto');
    const reasoning: string[] = [];
    const suggestions: string[] = [];

    // Analyser la requête
    const words = query.split(' ').length;
    const length = query.length;

    if (words <= 2) {
      reasoning.push('Requête courte - full-text suffira');
      suggestions.push('Utilisez le mode "text" pour plus de rapidité');
    }

    if (query.includes('comment') || query.includes('pourquoi')) {
      reasoning.push('Question complexe - vecteur recommandé');
      suggestions.push('Mode "hybrid" offrira les meilleurs résultats');
    }

    if (query.startsWith('test:') || query.startsWith('debug:')) {
      reasoning.push('Requête de test détectée');
      suggestions.push('Utilisez pgvector_search avec useRandomVector: true pour les tests');
    }

    if (length > 100) {
      reasoning.push('Requête longue - vecteur plus précis');
      suggestions.push('Mode "hybrid" pour combiner vitesse et précision');
    }

    // Calculer la confiance
    let confidence = 0.5;
    if (mode === 'text' && words <= 2) confidence = 0.8;
    if (mode === 'hybrid' && (query.includes('comment') || length > 50)) confidence = 0.9;
    if (mode === 'vector' && length > 20 && words > 2) confidence = 0.7;

    return {
      mode,
      confidence,
      reasoning,
      suggestions
    };
  }

  /**
   * Benchmark des différents modes
   */
  async benchmark(
    testQueries: string[],
    tableName: string,
    iterations: number = 3
  ): Promise<{
    text: { avgTime: number; successRate: number };
    vector: { avgTime: number; successRate: number };
    hybrid: { avgTime: number; successRate: number };
  }> {
    Logger.info(`🧪 Benchmark sur ${testQueries.length} requêtes (${iterations} itérations)...`);

    const modes = ['text', 'vector', 'hybrid'];
    const results: any = {};

    for (const mode of modes) {
      let totalTime = 0;
      let successCount = 0;

      for (let i = 0; i < iterations; i++) {
        for (const query of testQueries) {
          try {
            const start = Date.now();
            await this.search(query, { tableName, mode: mode as any });
            totalTime += Date.now() - start;
            successCount++;
          } catch {
            Logger.error(`❌ Échec mode ${mode}: "${query}"`);
          }
        }
      }

      results[mode] = {
        avgTime: totalTime / (testQueries.length * iterations),
        successRate: (successCount / (testQueries.length * iterations)) * 100
      };

      Logger.info(`✅ ${mode}: ${results[mode].avgTime.toFixed(2)}ms avg, ${results[mode].successRate.toFixed(1)}% success`);
    }

    return results;
  }

  /**
   * Suggestions de requêtes (délégué à HybridSearchService)
   */
  async getSuggestions(
    partialQuery: string,
    tableName: string,
    contentColumn: string = 'content',
    limit: number = 5
  ): Promise<string[]> {
    return this.hybridSearch.getSuggestions(partialQuery, tableName, contentColumn, limit);
  }
}
