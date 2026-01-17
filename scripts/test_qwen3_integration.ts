#!/usr/bin/env node

/**
 * Script de test pour l'intégration Qwen3 Embedding 8B + OpenRouter + pgvector
 *
 * Usage:
 *   npm run test:qwen3
 *
 * Prérequis:
 *   - Clé API OpenRouter configurée dans .env
 *   - Extension pgvector installée dans PostgreSQL
 *   - Migration SQL exécutée
 */

import { embeddingServiceOpenRouter } from '../src/services/embeddingServiceOpenRouter.js';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DATABASE || 'financial_analyst',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || '9022',
});

/**
 * Test 1: Connexion à la base de données
 */
async function testDatabaseConnection() {
  console.log('\n📊 Test 1: Connexion à la base de données...');
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT version()');
    console.log('✅ Connexion réussie!');
    console.log(`   Version PostgreSQL: ${result.rows[0].version.split(',')[0]}`);

    // Vérifier pgvector
    const pgvectorResult = await client.query(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
    );
    if (pgvectorResult.rows.length > 0) {
      console.log(`✅ Extension pgvector installée (v${pgvectorResult.rows[0].extversion})`);
    } else {
      console.log('❌ Extension pgvector NON installée!');
      console.log('   Exécutez: CREATE EXTENSION vector;');
    }

    // Vérifier la table embeddings
    const tableResult = await client.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'embeddings')"
    );
    if (tableResult.rows[0].exists) {
      console.log('✅ Table embeddings existe');
    } else {
      console.log('❌ Table embeddings NON trouvée!');
      console.log('   Exécutez le script de migration: migrate_to_qwen3_1024.sql');
    }

    client.release();
    return true;
  } catch (error: any) {
    console.error('❌ Erreur de connexion:', error.message);
    return false;
  }
}

/**
 * Test 2: Génération d'embedding avec OpenRouter
 */
async function testEmbeddingGeneration() {
  console.log('\n🤖 Test 2: Génération d\'embedding avec OpenRouter...');

  const testTexts = [
    'Bonjour, comment allez-vous?',
    'Les marchés financiers sont volatils aujourd\'hui',
    'Le Bitcoin a atteint un nouveau sommet'
  ];

  try {
    const info = embeddingServiceOpenRouter.getInfo();
    console.log(`📋 Configuration:`);
    console.log(`   • Provider: ${info.provider}`);
    console.log(`   • Modèle: ${info.model}`);
    console.log(`   • Dimensions: ${info.dimensions}`);
    console.log(`   • Clé API: ${info.apiKeyConfigured ? '✅ Configurée' : '❌ Manquante'}`);

    if (!info.apiKeyConfigured) {
      console.log('\n⚠️ Mode mock activé (pas de clé API)');
      console.log('   Configurez OPENROUTER_API_KEY dans .env pour le mode production');
    }

    console.log(`\n🔄 Génération d'embeddings pour ${testTexts.length} textes...`);

    const startTime = Date.now();
    const embeddings = [];

    for (const text of testTexts) {
      const embedding = await embeddingServiceOpenRouter.generateEmbedding(text, {
        useCache: false
      });
      embeddings.push({ text, embedding });
      console.log(`   ✅ "${text.substring(0, 40)}..." -> ${embedding.length} dimensions`);
    }

    const totalTime = Date.now() - startTime;
    console.log(`\n⏱️ Temps total: ${totalTime}ms`);
    console.log(`   Moyenne: ${(totalTime / testTexts.length).toFixed(2)}ms par texte`);

    // Tester le cache
    console.log('\n📦 Test du cache...');
    const cacheStart = Date.now();
    await embeddingServiceOpenRouter.generateEmbedding(testTexts[0], { useCache: true });
    const cacheTime = Date.now() - cacheStart;
    console.log(`   ✅ Embedding récupéré du cache en ${cacheTime}ms`);

    const cacheStats = embeddingServiceOpenRouter.getCacheStats();
    console.log(`   📊 Stats cache: ${cacheStats.size}/${cacheStats.maxSize} entrées`);

    return embeddings;
  } catch (error: any) {
    console.error('❌ Erreur génération embedding:', error.message);
    return null;
  }
}

/**
 * Test 3: Insertion dans PostgreSQL
 */
async function testDatabaseInsertion(embeddings: any[]) {
  if (!embeddings) {
    console.log('\n⏭️ Test 3: Insertion ignoré (pas d\'embeddings)');
    return;
  }

  console.log('\n💾 Test 3: Insertion dans PostgreSQL...');

  try {
    const client = await pool.connect();

    for (const { text, embedding } of embeddings) {
      // Convertir le vecteur en format PostgreSQL
      const vectorStr = `[${embedding.join(',')}]`;

      await client.query(
        'INSERT INTO embeddings (content, embedding, metadata) VALUES ($1, $2, $3)',
        [text, vectorStr, { source: 'test', language: 'fr' }]
      );

      console.log(`   ✅ Inséré: "${text.substring(0, 40)}..."`);
    }

    // Vérifier les statistiques
    const stats = await client.query('SELECT * FROM v_embeddings_stats');
    console.log('\n📊 Statistiques de la table:');
    console.log(`   • Total embeddings: ${stats.rows[0].total_embeddings}`);
    console.log(`   • Taille table: ${stats.rows[0].table_size}`);
    console.log(`   • Taille index: ${stats.rows[0].index_size}`);

    client.release();
    return true;
  } catch (error: any) {
    console.error('❌ Erreur insertion:', error.message);
    return false;
  }
}

/**
 * Test 4: Recherche sémantique
 */
async function testSemanticSearch() {
  console.log('\n🔍 Test 4: Recherche sémantique...');

  try {
    const client = await pool.connect();

    // Générer un embedding pour la requête
    const queryText = 'Comment ça va?';
    const queryEmbedding = await embeddingServiceOpenRouter.generateEmbedding(queryText, {
      useCache: false
    });
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    console.log(`   Requête: "${queryText}"`);

    // Rechercher les embeddings similaires
    const result = await client.query(
      `SELECT
        content,
        1 - (embedding <=> $1::vector) as similarity,
        metadata
      FROM embeddings
      ORDER BY embedding <=> $1::vector
      LIMIT 5`,
      [vectorStr]
    );

    console.log(`\n   Résultats (${result.rows.length}):`);
    for (const row of result.rows) {
      console.log(`   • ${row.similarity.toFixed(3)}: "${row.content}"`);
    }

    client.release();
    return true;
  } catch (error: any) {
    console.error('❌ Erreur recherche:', error.message);
    return false;
  }
}

/**
 * Test 5: Comparaison de performance
 */
async function testPerformanceComparison() {
  console.log('\n⚡ Test 5: Comparaison de performance...');

  const testTexts = [
    'Analyse technique des marchés',
    'Prévisions économiques',
    'Tendances cryptomonnaies',
    'Strégies d\'investissement',
    'Gestion de portefeuille'
  ];

  try {
    const results = await embeddingServiceOpenRouter.benchmark(testTexts);

    console.log('\n📊 Résultats benchmark:');
    console.log(`   • Mock: ${results.mock.avgTime.toFixed(2)}ms avg (${results.mock.successRate.toFixed(1)}% succès)`);
    if (results.openRouter) {
      console.log(`   • OpenRouter: ${results.openRouter.avgTime.toFixed(2)}ms avg (${results.openRouter.successRate.toFixed(1)}% succès)`);
      console.log(`   • Ratio: ${(results.openRouter.avgTime / results.mock.avgTime).toFixed(2)}x plus lent`);
    }

    return true;
  } catch (error: any) {
    console.error('❌ Erreur benchmark:', error.message);
    return false;
  }
}

/**
 * Fonction principale
 */
async function main() {
  console.log('🚀 Tests intégration Qwen3 Embedding 8B + OpenRouter + pgvector');
  console.log('=' .repeat(70));

  try {
    // Test 1: Connexion BD
    const dbOk = await testDatabaseConnection();
    if (!dbOk) {
      console.log('\n❌ Arrêt des tests: connexion BD échouée');
      return;
    }

    // Test 2: Génération embeddings
    const embeddings = await testEmbeddingGeneration();
    if (!embeddings) {
      console.log('\n❌ Arrêt des tests: génération embeddings échouée');
      return;
    }

    // Test 3: Insertion BD
    await testDatabaseInsertion(embeddings);

    // Test 4: Recherche sémantique
    await testSemanticSearch();

    // Test 5: Performance
    await testPerformanceComparison();

    console.log('\n✅ Tous les tests terminés!');
    console.log('\n🎯 Prochaines étapes:');
    console.log('   1. Configurez votre clé API OpenRouter dans .env');
    console.log('   2. Utilisez embeddingServiceOpenRouter dans votre code');
    console.log('   3. Insérez vos propres données avec: INSERT INTO embeddings ...');
    console.log('   4. Recherchez avec: SELECT * FROM search_semantic(...)');
    console.log('   5. Monitorer avec: SELECT * FROM v_embeddings_stats');

  } catch (error: any) {
    console.error('\n❌ Erreur critique:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
    console.log('\n👋 Au revoir!');
  }
}

// Exécuter les tests
main().catch(console.error);
