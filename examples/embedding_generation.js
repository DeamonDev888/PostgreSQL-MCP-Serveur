// =====================================================
// EXEMPLE: Génération d'embedding avec OpenAI
// =====================================================

// 1. Installer: npm install openai
const { OpenAI } = require('openai');

// 2. Configurer avec votre clé API
const openai = new OpenAI({
  apiKey: 'sk-...', // Votre clé OpenAI
});

/**
 * Génère un embedding à partir d'un texte
 * @param {string} text - Le texte à transformer en vecteur
 * @returns {Promise<number[]>} - Vecteur de 768 nombres
 */
async function generateEmbedding(text) {
  try {
    // Appel à l'API OpenAI
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small', // Modèle 768 dimensions
      input: text,
    });

    // Récupérer le vecteur
    const embedding = response.data[0].embedding;
    console.log(`✅ Embedding généré: ${embedding.length} dimensions`);
    return embedding;

  } catch (error) {
    console.error('❌ Erreur génération embedding:', error);
    throw error;
  }
}

// =====================================================
// UTILISATION CONCRÈTE
// =====================================================

async function searchWithRealEmbedding() {
  // 1. Question de l'utilisateur
  const userQuery = "Comment utiliser les transformers en Python?";

  // 2. Générer l'embedding de cette question
  console.log('🔄 Génération embedding...');
  const queryVector = await generateEmbedding(userQuery);

  // 3. Utiliser CE vecteur pour la recherche
  console.log('🔍 Recherche vectorielle...');
  const results = await pgvector_search({
    tableName: "documents",
    queryVector: queryVector,  // ← Vecteur basé sur le SENS du texte
    topK: 10
  });

  // 4. Afficher les résultats
  console.log('📊 Résultats:');
  console.log(results);
}

// Exécuter
searchWithRealEmbedding()
  .then(() => console.log('✅ Terminé'))
  .catch(err => console.error('❌ Erreur:', err));

// =====================================================
// VARIANTE: Sans API (modèle local)
// =====================================================

/**
 * Alternative: Modèle local (plus lent mais gratuit)
 * Nécessite: npm install @xenova/transformers
 */
async function generateEmbeddingLocal(text) {
  const { pipeline } = await import('@xenova/transformers');

  // Charger le modèle (la première fois prend du temps)
  const extractor = await pipeline(
    'feature-extraction',
    'Xenova/all-mpnet-base-v2' // Modèle 768 dims
  );

  // Extraire les features
  const output = await extractor(text);
  const embedding = output.data; // Array de 768 nombres

  return Array.from(embedding);
}

// =====================================================
// WORKFLOW COMPLET
// =====================================================

/**
 * Fonction de recherche intelligente
 */
async function intelligentSearch(query, useHybrid = false) {
  // Mode TEST: Vecteur aléatoire
  if (query.startsWith('TEST:')) {
    return {
      useRandomVector: true,
      dimensions: 768,
      topK: 10
    };
  }

  // Mode PROD: Vecteur réel
  const queryVector = await generateEmbedding(query);

  if (useHybrid) {
    // Recherche hybride: Full-text + Vecteur
    const textResults = await fullTextSearch(query);
    return {
      tableName: "documents",
      queryVector: queryVector,
      whereClause: `id IN (${textResults.map(r => r.id).join(',')})`,
      topK: 10
    };
  }

  // Recherche vectorielle simple
  return {
    tableName: "documents",
    queryVector: queryVector,
    topK: 10
  };
}
