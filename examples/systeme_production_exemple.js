// =====================================================
// EXEMPLE COMPLET: Système de Production
// =====================================================

const { embeddingService } = require('../src/services/embeddingService.js');
const { HybridSearchService } = require('../src/services/hybridSearchService.js');
const { IntelligentSearchService } = require('../src/services/intelligentSearchService.js');
const { Pool } = require('pg');
require('dotenv').config();

// Configuration PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:9022@localhost:5432/financial_analyst',
});

// =====================================================
// 1. GÉNÉRATION D'EMBEDDING
// =====================================================

async function example1_GenerateEmbedding() {
  console.log('\n=== 1. Génération d\'Embedding ===');

  const queries = [
    "Qu'est-ce que l'intelligence artificielle?",
    "Comment fonctionne le machine learning?",
    "Python vs JavaScript"
  ];

  for (const query of queries) {
    console.log(`\n📝 Requête: "${query}"`);

    // Avec cache
    const start = Date.now();
    const embedding1 = await embeddingService.generateEmbedding(query, { useCache: true });
    const time1 = Date.now() - start;
    console.log(`⏱️ 1ère génération: ${time1}ms (${embedding1.length} dimensions)`);

    // Récupération du cache
    const start2 = Date.now();
    const embedding2 = await embeddingService.generateEmbedding(query, { useCache: true });
    const time2 = Date.now() - start2;
    console.log(`📦 2ème génération (cache): ${time2}ms`);

    // Vérifier que c'est identique
    const identical = embedding1.every((val, i) => val === embedding2[i]);
    console.log(`✅ Cache valide: ${identical ? 'OUI' : 'NON'}`);
  }

  // Statistiques du cache
  const stats = embeddingService.getCacheStats();
  console.log(`\n📊 Cache: ${stats.size}/${stats.maxSize} embeddings`);
}

// =====================================================
// 2. RECHERCHE HYBRIDE
// =====================================================

async function example2_HybridSearch() {
  console.log('\n=== 2. Recherche Hybride ===');

  const hybridSearch = new HybridSearchService(pool);

  const query = "Comment apprendre le Python rapidement?";
  console.log(`\n📝 Requête: "${query}"`);

  try {
    const results = await hybridSearch.search(query, {
      tableName: 'documents',
      topK: 5,
      hybridMode: true,
      useCache: true
    });

    console.log(`\n📊 Résultats: ${results.results.length}`);
    console.log(`⏱️ Temps total: ${results.metadata.executionTime}ms`);
    console.log(`🔍 Mode: ${results.metadata.mode}`);

    if (results.metadata.embeddingTime) {
      console.log(`🧠 Embedding: ${results.metadata.embeddingTime}ms`);
    }
    if (results.metadata.textSearchTime) {
      console.log(`📄 Full-text: ${results.metadata.textSearchTime}ms`);
    }
    if (results.metadata.vectorSearchTime) {
      console.log(`🎯 Vecteur: ${results.metadata.vectorSearchTime}ms`);
    }

    // Afficher les top 3 résultats
    console.log('\n🏆 Top 3 résultats:');
    results.results.slice(0, 3).forEach((doc, index) => {
      console.log(`\n${index + 1}. Score: ${(doc.final_score * 100).toFixed(1)}%`);
      console.log(`   Similarité: ${(doc.similarity * 100).toFixed(1)}%`);
      if (doc.content) {
        const content = doc.content.substring(0, 100) + '...';
        console.log(`   Contenu: ${content}`);
      }
    });

  } catch (error) {
    console.error('❌ Erreur:', error.message);
  }
}

// =====================================================
// 3. RECHERCHE INTELLIGENTE (AUTO)
 // =====================================================

async function example3_IntelligentSearch() {
  console.log('\n=== 3. Recherche Intelligente (Auto) ===');

  const intelligentSearch = new IntelligentSearchService(pool);

  const testQueries = [
    "Python",                    // Court → mode text
    "test: debug performance",   // Test → mode random
    "Comment fonctionne l'intelligence artificielle?",  // Complexe → mode hybrid
    "Machine learning"           // Moyen → mode vector
  ];

  for (const query of testQueries) {
    console.log(`\n📝 Requête: "${query}"`);

    try {
      const results = await intelligentSearch.search(query, {
        tableName: 'documents',
        mode: 'auto',
        topK: 3
      });

      console.log(`🎯 Mode détecté: ${results.metadata.detectedMode}`);
      console.log(`⏱️ Temps: ${results.metadata.executionTime}ms`);
      console.log(`📊 Résultats: ${results.results.length}`);

    } catch (error) {
      console.error('❌ Erreur:', error.message);
    }
  }
}

// =====================================================
// 4. ANALYSE DE REQUÊTE
// =====================================================

async function example4_AnalyzeQuery() {
  console.log('\n=== 4. Analyse de Requête ===');

  const intelligentSearch = new IntelligentSearchService(pool);

  const queries = [
    "AI",
    "Comment utiliser Docker?",
    "Quelle est la différence entre Python et JavaScript?"
  ];

  for (const query of queries) {
    console.log(`\n📝 Requête: "${query}"`);

    const analysis = await intelligentSearch.analyzeQuery(query);

    console.log(`🎯 Mode recommandé: ${analysis.mode}`);
    console.log(`🎚️ Confiance: ${(analysis.confidence * 100).toFixed(0)}%`);

    if (analysis.reasoning.length > 0) {
      console.log('🧠 Raisonnement:');
      analysis.reasoning.forEach(r => console.log(`   • ${r}`));
    }

    if (analysis.suggestions.length > 0) {
      console.log('💡 Suggestions:');
      analysis.suggestions.forEach(s => console.log(`   • ${s}`));
    }
  }
}

// =====================================================
// 5. BENCHMARK DES MODES
// =====================================================

async function example5_Benchmark() {
  console.log('\n=== 5. Benchmark des Modes ===');

  const intelligentSearch = new IntelligentSearchService(pool);

  const testQueries = [
    "Python",
    "Machine learning",
    "Intelligence artificielle",
    "Comment coder en JavaScript?"
  ];

  try {
    const results = await intelligentSearch.benchmark(
      testQueries,
      'documents',
      2  // 2 itérations pour aller vite
    );

    console.log('\n📊 Résultats du benchmark:');
    console.log('| Mode   | Temps Moyen | Taux Succès |');
    console.log('|--------|-------------|-------------|');

    Object.entries(results).forEach(([mode, stats]) => {
      console.log(`| ${mode.padEnd(6)} | ${stats.avgTime.toFixed(2)}ms`.padEnd(12) + ` | ${stats.successRate.toFixed(1)}%`.padEnd(11) + ` |`);
    });

    // Recommandation
    const fastest = Object.entries(results).reduce((a, b) =>
      results[a[0]].avgTime < results[b[0]].avgTime ? a : b
    )[0];

    console.log(`\n🏆 Le plus rapide: ${fastest}`);
    console.log(`💡 Recommandation: Utilisez le mode \`${fastest}\` pour cette table`);

  } catch (error) {
    console.error('❌ Erreur:', error.message);
  }
}

// =====================================================
// 6. WORKFLOW COMPLET DE PRODUCTION
// =====================================================

async function example6_ProductionWorkflow() {
  console.log('\n=== 6. Workflow Production Complet ===');

  const intelligentSearch = new IntelligentSearchService(pool);

  const userQuery = "Je veux apprendre le machine learning, par où commencer?";

  console.log(`\n📝 Requête utilisateur: "${userQuery}"`);

  // Étape 1: Analyser
  console.log('\n1️⃣ Analyse de la requête...');
  const analysis = await intelligentSearch.analyzeQuery(userQuery);
  console.log(`   → Mode recommandé: ${analysis.mode}`);

  // Étape 2: Rechercher
  console.log('\n2️⃣ Recherche...');
  const results = await intelligentSearch.search(userQuery, {
    tableName: 'documents',
    mode: 'auto',
    topK: 5
  });

  console.log(`   → Mode utilisé: ${results.metadata.actualMode}`);
  console.log(`   → Temps total: ${results.metadata.executionTime}ms`);
  console.log(`   → Résultats trouvés: ${results.results.length}`);

  // Étape 3: Afficher les résultats
  console.log('\n3️⃣ Résultats:');
  results.results.forEach((doc, index) => {
    const score = doc.final_score ? (doc.final_score * 100).toFixed(1)
                 : doc.similarity ? (doc.similarity * 100).toFixed(1)
                 : 'N/A';
    console.log(`\n   ${index + 1}. Score: ${score}%`);
    if (doc.content) {
      const preview = doc.content.substring(0, 80) + '...';
      console.log(`      ${preview}`);
    }
  });

  // Étape 4: Suggestions
  console.log('\n4️⃣ Suggestions pour affiner la recherche:');
  const suggestions = await intelligentSearch.getSuggestions(
    'machine learning',
    'documents',
    3
  );
  suggestions.forEach(s => console.log(`   • ${s}`));
}

// =====================================================
// FONCTION PRINCIPALE
// =====================================================

async function main() {
  console.log('🚀 Démarrage des exemples de production\n');
  console.log('='.repeat(50));

  try {
    // 1. Génération d'embedding
    await example1_GenerateEmbedding();

    // 2. Recherche hybride
    await example2_HybridSearch();

    // 3. Recherche intelligente
    await example3_IntelligentSearch();

    // 4. Analyse de requête
    await example4_AnalyzeQuery();

    // 5. Benchmark
    await example5_Benchmark();

    // 6. Workflow production
    await example6_ProductionWorkflow();

    console.log('\n' + '='.repeat(50));
    console.log('✅ Tous les exemples terminés avec succès!\n');

  } catch (error) {
    console.error('\n❌ Erreur:', error);
  } finally {
    await pool.end();
    console.log('🔚 Connexions fermées');
  }
}

// Exécuter si appelé directement
if (require.main === module) {
  main();
}

module.exports = {
  example1_GenerateEmbedding,
  example2_HybridSearch,
  example3_IntelligentSearch,
  example4_AnalyzeQuery,
  example5_Benchmark,
  example6_ProductionWorkflow
};
