#!/usr/bin/env node

import { Pool } from 'pg';
import Logger from '../utils/logger.js';
import { embeddingService } from './embeddingService.js';

/**
 * Service de recherche hybride (Full-text + Vecteur)
 * Combine la rapidité du full-text avec la précision du vecteur
 */
export class HybridSearchService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Recherche hybride intelligente
   * @param query - Requête utilisateur
   * @param options - Options de recherche
   * @returns Résultats classés par pertinence
   */
  async search(
    query: string,
    options: {
      tableName: string;
      vectorColumn?: string;
      contentColumn?: string;
      topK?: number;
      textLimit?: number;
      hybridMode?: boolean;
      useCache?: boolean;
    }
  ): Promise<{
    results: any[];
    metadata: {
      query: string;
      mode: 'hybrid' | 'vector' | 'text';
      executionTime: number;
      totalResults: number;
      embeddingTime?: number;
      textSearchTime?: number;
      vectorSearchTime?: number;
    };
  }> {
    const {
      tableName,
      vectorColumn = 'embedding',
      contentColumn = 'content',
      topK = 10,
      textLimit = 100,
      hybridMode = true,
      useCache = true
    } = options;

    const startTime = Date.now();
    let results: any[] = [];
    let metadata: any = {
      query,
      mode: 'hybrid' as const,
      executionTime: 0,
      totalResults: 0
    };

    try {
      if (hybridMode) {
        // MODE HYBRIDE: Full-text + Vecteur
        const hybridResults = await this.performHybridSearch(
          query,
          tableName,
          vectorColumn,
          contentColumn,
          topK,
          textLimit,
          useCache
        );

        results = hybridResults.results;
        metadata = { ...metadata, ...hybridResults.metadata, mode: 'hybrid' };
      } else {
        // MODE VECTEUR SEUL
        const vectorResults = await this.performVectorSearch(
          query,
          tableName,
          vectorColumn,
          topK,
          useCache
        );

        results = vectorResults.results;
        metadata = { ...metadata, ...vectorResults.metadata, mode: 'vector' };
      }

      metadata.executionTime = Date.now() - startTime;
      metadata.totalResults = results.length;

      Logger.info(`✅ Recherche terminée (${metadata.mode}): ${results.length} résultats en ${metadata.executionTime}ms`);

      return {
        results,
        metadata
      };

    } catch (error: any) {
      Logger.error('❌ Erreur recherche hybride:', error.message);
      throw new Error(`Échec de recherche: ${error.message}`);
    }
  }

  /**
   * Recherche hybride: Full-text puis vecteur
   */
  private async performHybridSearch(
    query: string,
    tableName: string,
    vectorColumn: string,
    contentColumn: string,
    topK: number,
    textLimit: number,
    useCache: boolean
  ): Promise<{ results: any[]; metadata: any }> {
    const startTime = Date.now();
    const client = await this.pool.connect();

    try {
      // ÉTAPE 1: Recherche full-text (filtrage rapide)
      Logger.debug('🔍 Étape 1: Recherche full-text...');
      const textStartTime = Date.now();

      const textResults = await client.query(
        `
        SELECT id, ${contentColumn} as content,
               ts_rank(to_tsvector('french', ${contentColumn}),
                       plainto_tsquery('french', $1)) as text_rank
        FROM ${tableName}
        WHERE to_tsvector('french', ${contentColumn}) @@ plainto_tsquery('french', $1)
        ORDER BY text_rank DESC
        LIMIT $2
        `,
        [query, textLimit]
      );

      const textSearchTime = Date.now() - textStartTime;
      Logger.debug(`✅ Full-text: ${textResults.rows.length} résultats en ${textSearchTime}ms`);

      if (textResults.rows.length === 0) {
        return {
          results: [],
          metadata: {
            textSearchTime,
            vectorSearchTime: 0,
            embeddingTime: 0,
            textResultsCount: 0
          }
        };
      }

      // ÉTAPE 2: Génération d'embedding de la requête
      Logger.debug('🧠 Étape 2: Génération embedding...');
      const embeddingStartTime = Date.now();
      const queryVector = await embeddingService.generateEmbedding(query, { useCache });
      const embeddingTime = Date.now() - embeddingStartTime;
      Logger.debug(`✅ Embedding: ${embeddingTime}ms`);

      // ÉTAPE 3: Recherche vectorielle dans les résultats filtrés
      Logger.debug('🎯 Étape 3: Recherche vectorielle...');
      const vectorStartTime = Date.now();

      const ids = textResults.rows.map((row: any) => row.id);
      const vectorQuery = `
        SELECT
          d.*,
          1 - (d.${vectorColumn} <=> $1::vector) as similarity,
          t.text_rank as text_rank
        FROM ${tableName} d
        JOIN (
          VALUES ${ids.map((id: number, index: number) => `($${index + 2}, ${index + 1})`).join(', ')}
        ) AS t(id, rank) ON d.id = t.id
        ORDER BY d.${vectorColumn} <=> $1::vector
        LIMIT $${ids.length + 2}
      `;

      const vectorResults = await client.query(vectorQuery, [
        `[${queryVector.join(',')}]`,
        ...ids,
        topK
      ]);

      const vectorSearchTime = Date.now() - vectorStartTime;
      Logger.debug(`✅ Vecteur: ${vectorResults.rows.length} résultats en ${vectorSearchTime}ms`);

      // ÉTAPE 4: Fusion et classement
      const mergedResults = vectorResults.rows.map((row: any, index: number) => ({
        ...row,
        rank: index + 1,
        final_score: (row.similarity * 0.7) + (row.text_rank * 0.3), // Score hybride
      }));

      // Trier par score final
      mergedResults.sort((a: any, b: any) => b.final_score - a.final_score);

      return {
        results: mergedResults,
        metadata: {
          textSearchTime,
          embeddingTime,
          vectorSearchTime,
          textResultsCount: textResults.rows.length,
          vectorResultsCount: vectorResults.rows.length
        }
      };

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
    vectorColumn: string,
    topK: number,
    useCache: boolean
  ): Promise<{ results: any[]; metadata: any }> {
    const startTime = Date.now();
    const client = await this.pool.connect();

    try {
      // Générer l'embedding
      const embeddingStartTime = Date.now();
      const queryVector = await embeddingService.generateEmbedding(query, { useCache });
      const embeddingTime = Date.now() - embeddingStartTime;

      // Recherche vectorielle
      const vectorStartTime = Date.now();
      const results = await client.query(
        `
        SELECT *, 1 - (${vectorColumn} <=> $1::vector) as similarity
        FROM ${tableName}
        ORDER BY ${vectorColumn} <=> $1::vector
        LIMIT $2
        `,
        [`[${queryVector.join(',')}]`, topK]
      );

      const vectorSearchTime = Date.now() - vectorStartTime;

      return {
        results: results.rows,
        metadata: {
          embeddingTime,
          vectorSearchTime
        }
      };

    } finally {
      client.release();
    }
  }

  /**
   * Recherche full-text simple (sans vecteur)
   */
  async textSearch(
    query: string,
    tableName: string,
    contentColumn: string = 'content',
    topK: number = 10
  ): Promise<{ results: any[]; metadata: any }> {
    const startTime = Date.now();
    const client = await this.pool.connect();

    try {
      const results = await client.query(
        `
        SELECT *,
               ts_rank(to_tsvector('french', ${contentColumn}),
                       plainto_tsquery('french', $1)) as rank
        FROM ${tableName}
        WHERE to_tsvector('french', ${contentColumn}) @@ plainto_tsquery('french', $1)
        ORDER BY rank DESC
        LIMIT $2
        `,
        [query, topK]
      );

      return {
        results: results.rows,
        metadata: {
          executionTime: Date.now() - startTime,
          totalResults: results.rows.length
        }
      };

    } finally {
      client.release();
    }
  }

  /**
   * Suggestions de requêtes (auto-complétion)
   */
  async getSuggestions(
    partialQuery: string,
    tableName: string,
    contentColumn: string = 'content',
    limit: number = 5
  ): Promise<string[]> {
    const client = await this.pool.connect();

    try {
      const results = await client.query(
        `
        SELECT DISTINCT ${contentColumn}
        FROM ${tableName}
        WHERE ${contentColumn} ILIKE $1
        LIMIT $2
        `,
        [`%${partialQuery}%`, limit]
      );

      return results.rows.map((row: any) => row[contentColumn]);

    } finally {
      client.release();
    }
  }
}
