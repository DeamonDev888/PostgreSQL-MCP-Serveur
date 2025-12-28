import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { Pool } from 'pg';
import Logger from '../utils/logger.js';
import { embeddingService } from '../services/embeddingService.js';

/**
 * Module pg_vector pour PostgreSQL MCP Server
 * Permet de travailler avec des vecteurs et faire des recherches de similarité
 */

export interface PGVectorConfig {
  tableName: string;
  vectorColumn: string;
  dimensions: number;
  schema?: string;
}

export class PGVectorTools {
  private pool: Pool;
  private server: FastMCP;

  constructor(pool: Pool, server: FastMCP) {
    this.pool = pool;
    this.server = server;
  }

  /**
   * Guide des modèles d'embedding standards avec leurs dimensions
   */
  private static readonly EMBEDDING_MODELS_GUIDE: Record<number, { model: string; provider: string; description: string }> = {
    1536: {
      model: 'text-embedding-ada-002',
      provider: 'OpenAI',
      description: 'Modèle standard OpenAI, excellent rapport qualité/coût'
    },
    3072: {
      model: 'text-embedding-3-large',
      provider: 'OpenAI',
      description: 'Modèle haute précision OpenAI (2024+)'
    },
    1024: {
      model: 'text-embedding-3-small',
      provider: 'OpenAI',
      description: 'Modèle léger et rapide OpenAI (2024+)'
    },
    768: {
      model: 'bert-base-uncased / all-mpnet-base-v2',
      provider: 'HuggingFace / Sentence Transformers',
      description: 'Modèle open-source performant'
    },
    384: {
      model: 'all-MiniLM-L6-v2',
      provider: 'Sentence Transformers',
      description: 'Modèle léger, idéal pour le local'
    },
    4096: {
      model: 'embed-english-v3.0',
      provider: 'Cohere',
      description: 'Modèle multilingue haute performance'
    },
    256: {
      model: 'nomic-embed-text-v1',
      provider: 'Nomic AI',
      description: 'Modèle open-source compact'
    }
  };

  /**
   * Génère le guide des modèles d'embedding pour l'aide LLM
   */
  private getEmbeddingModelsGuide(): string {
    let guide = `\n📚 **Guide des Modèles d'Embedding Standards**\n\n`;
    guide += `| Dimensions | Modèle | Provider | Description |\n`;
    guide += `|------------|--------|----------|-------------|\n`;

    const sortedDims = Object.keys(PGVectorTools.EMBEDDING_MODELS_GUIDE)
      .map(Number)
      .sort((a, b) => a - b);

    for (const dim of sortedDims) {
      const info = PGVectorTools.EMBEDDING_MODELS_GUIDE[dim];
      guide += `| **${dim}** | ${info.model} | ${info.provider} | ${info.description} |\n`;
    }

    guide += `\n💡 **Recommandation:** Pour la production, utilisez **1536** (OpenAI ada-002) ou **384** (MiniLM local)\n`;
    return guide;
  }

  /**
   * Extrait les dimensions depuis un message d'erreur
   */
  private extractDimensionsFromError(msg: string): { expected?: number; actual?: number } {
    // Pattern: "expected X dimensions, not Y" ou "expected X, got Y"
    const patterns = [
      /expected\s+(\d+)\s+dimensions?,\s+(?:not|got)\s+(\d+)/i,
      /(\d+)\s+dimensions?\s+expected.*?(\d+)\s+(?:provided|given|got)/i,
      /vector\((\d+)\).*?(\d+)\s+(?:dimensions?|values?)/i
    ];

    for (const pattern of patterns) {
      const match = msg.match(pattern);
      if (match) {
        return { expected: parseInt(match[1]), actual: parseInt(match[2]) };
      }
    }
    return {};
  }

  /**
   * Formate les erreurs PostgreSQL avec diagnostics et suggestions
   */
  private formatError(error: any, context: string): string {
    const msg = error.message || String(error);
    const msgLower = msg.toLowerCase();

    // Mapping des erreurs courantes vers des solutions
    const errorMap: Record<string, { explanation: string; suggestion: string; showGuide?: boolean }> = {
      'column': {
        explanation: 'La colonne spécifiée n\'existe pas dans la table',
        suggestion: 'Vérifiez le nom de la colonne ou créez-la avec pgvector_create_column'
      },
      'relation': {
        explanation: 'La table spécifiée n\'existe pas',
        suggestion: 'Créez la table d\'abord avec pgvector_create_column (createTable:true)'
      },
      'dimension': {
        explanation: 'Les dimensions du vecteur ne correspondent pas à la colonne',
        suggestion: 'Assurez-vous que votre modèle d\'embedding génère le bon nombre de dimensions',
        showGuide: true
      },
      'expected': {
        explanation: 'Incompatibilité de dimensions entre le vecteur et la colonne',
        suggestion: 'Le vecteur envoyé n\'a pas le même nombre de dimensions que la colonne',
        showGuide: true
      },
      'vector': {
        explanation: 'Le format du vecteur est incorrect',
        suggestion: 'Le vecteur doit être un tableau de nombres (ex: [0.1, 0.2, 0.3])'
      },
      'extension "vector" does not exist': {
        explanation: 'L\'extension pgvector n\'est pas installée',
        suggestion: 'Utilisez pgvector_check_extension avec autoInstall:true'
      },
      'value too long for type': {
        explanation: 'Le vecteur a trop de dimensions pour la colonne',
        suggestion: 'Vérifiez les dimensions de la colonne vectorielle',
        showGuide: true
      }
    };

    // Chercher une correspondance
    let matched = false;
    let explanation = '';
    let suggestion = '';
    let showGuide = false;

    for (const [key, value] of Object.entries(errorMap)) {
      if (msgLower.includes(key)) {
        explanation = value.explanation;
        suggestion = value.suggestion;
        showGuide = value.showGuide || false;
        matched = true;
        break;
      }
    }

    let output = `❌ **Erreur: ${context}**\n\n`;
    output += `📝 Message: ${msg}\n`;

    if (matched) {
      output += `\n💡 **Explication:** ${explanation}\n`;
      output += `🔧 **Suggestion:** ${suggestion}\n`;

      // Si c'est une erreur de dimensions, extraire les infos et afficher le guide
      if (showGuide) {
        const dims = this.extractDimensionsFromError(msg);

        if (dims.expected || dims.actual) {
          output += `\n📐 **Analyse des dimensions:**\n`;
          if (dims.expected) {
            output += `   • Attendu par la table: **${dims.expected}** dimensions\n`;
            const expectedModel = PGVectorTools.EMBEDDING_MODELS_GUIDE[dims.expected];
            if (expectedModel) {
              output += `     → Compatible avec: ${expectedModel.model} (${expectedModel.provider})\n`;
            }
          }
          if (dims.actual) {
            output += `   • Reçu dans le vecteur: **${dims.actual}** dimensions\n`;
            const actualModel = PGVectorTools.EMBEDDING_MODELS_GUIDE[dims.actual];
            if (actualModel) {
              output += `     → Correspond à: ${actualModel.model} (${actualModel.provider})\n`;
            } else {
              output += `     → ⚠️ Dimension non-standard (vecteur de test ?)\n`;
            }
          }
        }

        output += `\n🔧 **Solutions possibles:**\n`;
        output += `   1. Modifier la colonne: \`ALTER TABLE <table> ALTER COLUMN embedding TYPE vector(<N>);\`\n`;
        output += `   2. Utiliser un modèle d'embedding compatible avec les dimensions de la table\n`;
        output += `   3. Recréer la table avec les bonnes dimensions via pgvector_create_column\n`;

        output += this.getEmbeddingModelsGuide();
      }
    } else {
      output += `\n💡 Vérifiez:\n`;
      output += `   - La connexion à la base de données\n`;
      output += `   - L\'extension pgvector est installée\n`;
      output += `   - Les noms de table/colonne sont corrects\n`;
    }

    return output;
  }

  /**
   * Enregistre tous les outils pg_vector sur le serveur MCP
   */
  registerTools(): void {
    this.checkExtension();
    this.createVectorColumn();
    this.insertVector();
    this.vectorSearch();
    this.generateRandomVector();
    this.createVectorIndex();
    this.deleteVectors();
    this.vectorStats();
    this.listVectorTables();
    this.batchInsertVectors();
    this.updateVector();
    this.validateVectors();
    this.normalizeVector();
    this.diagnostic();
    this.analyzeSlowQueries();
    this.pgvectorHelp();

    Logger.info('✅ Outils pg_vector enregistrés (17 outils)');
  }

  // ========================================================================
  // 1. Vérifier si l'extension pg_vector est installée
  // ========================================================================
  private checkExtension(): void {
    this.server.addTool({
      name: 'pgvector_check_extension',
      description: 'Vérifie si l\'extension pg_vector est installée et retourne sa version',
      parameters: z.object({
        autoInstall: z.boolean().optional().default(false).describe('Installer automatiquement l\'extension si absente'),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();

          // Vérifier si l'extension existe
          const checkResult = await client.query(`
            SELECT EXISTS(
              SELECT 1 FROM pg_extension WHERE extname = 'vector'
            ) as installed
          `);

          const isInstalled = checkResult.rows[0].installed;

          if (!isInstalled) {
            if (args.autoInstall) {
              await client.query('CREATE EXTENSION IF NOT EXISTS vector');
              Logger.info('✅ Extension pg_vector installée');
              await client.release();
              return '✅ Extension pg_vector installée avec succès';
            } else {
              await client.release();
              return '❌ Extension pg_vector non installée. Utilisez autoInstall:true pour l\'installer automatiquement.\n\n' +
                     '💡 Installation manuelle: CREATE EXTENSION vector;';
            }
          }

          // Récupérer la version
          const versionResult = await client.query(`
            SELECT extversion as version
            FROM pg_extension
            WHERE extname = 'vector'
          `);

          await client.release();

          const version = versionResult.rows[0].version;
          return `✅ Extension pg_vector installée (version: ${version})`;
        } catch (error: any) {
          Logger.error('❌ [pgvector_check_extension]', error.message);

          // Message d'erreur amélioré pour l'extension non disponible
          if (error.message.includes('could not open extension control file') ||
              error.message.includes('extension "vector" is not available') ||
              error.message.includes('No such file or directory')) {
            return `❌ **Extension pg_vector non disponible sur ce serveur PostgreSQL**

L'extension pg_vector doit être installée sur le serveur PostgreSQL avant de pouvoir l'utiliser.

📦 **Installation sur Linux/Ubuntu:**
\`\`\`bash
# Pour PostgreSQL 14+
sudo apt-get install postgresql-14-pgvector
# Ou compiler depuis les sources
git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install
\`\`\`

📦 **Installation sur macOS (Homebrew):**
\`\`\`bash
brew install pgvector
\`\`\`

📦 **Activation dans PostgreSQL:**
\`\`\`sql
-- Se connecter à la base de données
\\c votre_base

-- Créer l'extension
CREATE EXTENSION vector;
\`\`\`

🔗 **Documentation:** https://github.com/pgvector/pgvector

💡 Une fois pg_vector installé sur le serveur, relancez la commande avec autoInstall:true`;
          }

          return this.formatError(error, 'Erreur');
        }
      },
    });
  }

  // ========================================================================
  // 2. Créer une colonne vectorielle
  // ========================================================================
  private createVectorColumn(): void {
    this.server.addTool({
      name: 'pgvector_create_column',
      description: 'Ajoute une colonne vectorielle à une table existante ou crée une nouvelle table avec vecteurs',
      parameters: z.object({
        tableName: z.string().describe('Nom de la table'),
        vectorColumn: z.string().optional().default('embedding').describe('Nom de la colonne vectorielle'),
        dimensions: z.number().describe('Dimension des vecteurs (ex: 1536 pour OpenAI ada-002)'),
        schema: z.string().optional().default('public').describe('Schéma de la table'),
        createTable: z.boolean().optional().default(false).describe('Créer la table si elle n\'existe pas'),
        idColumn: z.string().optional().default('id').describe('Nom de la colonne ID (si création de table)'),
        idType: z.string().optional().default('SERIAL PRIMARY KEY').describe('Type de la colonne ID'),
        additionalColumns: z.string().optional().describe('Colonnes supplémentaires (ex: content TEXT, metadata JSONB)'),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();

          // Vérifier que pg_vector est installé
          const extCheck = await client.query(`
            SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') as installed
          `);

          if (!extCheck.rows[0].installed) {
            await client.release();
            return '❌ L\'extension pg_vector n\'est pas installée. Utilisez pgvector_check_extension d\'abord.';
          }

          const fullTableName = `"${args.schema}"."${args.tableName}"`;

          // Vérifier si la table existe
          const tableCheck = await client.query(`
            SELECT EXISTS(
              SELECT 1 FROM information_schema.tables
              WHERE table_schema = $1 AND table_name = $2
            ) as exists
          `, [args.schema, args.tableName]);

          const tableExists = tableCheck.rows[0].exists;

          if (!tableExists && args.createTable) {
            // Créer la table
            let createSQL = `CREATE TABLE ${fullTableName} (\n`;
            createSQL += `  ${args.idColumn} ${args.idType},\n`;
            createSQL += `  ${args.vectorColumn} vector(${args.dimensions})`;

            if (args.additionalColumns) {
              createSQL += `,\n  ${args.additionalColumns}`;
            }

            createSQL += `\n)`;

            await client.query(createSQL);
            Logger.info(`✅ Table ${args.tableName} créée avec colonne vectorielle`);
          } else if (tableExists) {
            // Vérifier si la colonne existe déjà
            const colCheck = await client.query(`
              SELECT EXISTS(
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
              ) as exists
            `, [args.schema, args.tableName, args.vectorColumn]);

            if (colCheck.rows[0].exists) {
              await client.release();
              return `⚠️ La colonne ${args.vectorColumn} existe déjà dans ${args.schema}.${args.tableName}`;
            }

            // Ajouter la colonne
            await client.query(`
              ALTER TABLE ${fullTableName}
              ADD COLUMN ${args.vectorColumn} vector(${args.dimensions})
            `);
            Logger.info(`✅ Colonne vectorielle ajoutée à ${args.tableName}`);
          } else {
            await client.release();
            return `❌ La table ${args.schema}.${args.tableName} n'existe pas. Utilisez createTable:true pour la créer.`;
          }

          await client.release();

          return `✅ Colonne vectorielle créée:\n` +
                 `   Table: ${args.schema}.${args.tableName}\n` +
                 `   Colonne: ${args.vectorColumn}\n` +
                 `   Dimensions: ${args.dimensions}\n\n` +
                 `💡 Vous pouvez maintenant insérer des vecteurs avec pgvector_insert_vector`;
        } catch (error: any) {
          Logger.error('❌ [pgvector_create_column]', error.message);
          return this.formatError(error, 'Erreur');
        }
      },
    });
  }

  // ========================================================================
  // 3. Insérer un vecteur
  // ========================================================================
  private insertVector(): void {
    this.server.addTool({
      name: 'pgvector_insert_vector',
      description: `Insère un vecteur dans une table.

🤖 Pour les agents LLM: Utilisez pgvector_insert_with_embedding qui génère
automatiquement un vrai embedding basé sur le contenu textuel.`,
      parameters: z.object({
        tableName: z.string().describe('Nom de la table'),
        vectorColumn: z.string().optional().default('embedding').describe('Nom de la colonne vectorielle'),
        vector: z.array(z.number()).describe('Tableau de nombres représentant le vecteur'),
        schema: z.string().optional().default('public').describe('Schéma de la table'),
        content: z.string().optional().describe('Contenu textuel associé au vecteur'),
        metadata: z.record(z.any()).optional().describe('Métadonnées JSON associées (objet clé/valeur)'),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();

          const vectorString = `[${args.vector.join(',')}]`;
          const fullTableName = `"${args.schema}"."${args.tableName}"`;

          let query = `INSERT INTO ${fullTableName} (${args.vectorColumn}`;
          let values: any[] = [vectorString];
          let paramIndex = 2;

          // Colonnes additionnelles
          const columns: string[] = [];
          const valuePlaceholders: string[] = [];

          if (args.content !== undefined) {
            columns.push('content');
            valuePlaceholders.push(`$${paramIndex++}`);
            values.push(args.content);
          }

          if (args.metadata !== undefined) {
            columns.push('metadata');
            valuePlaceholders.push(`$${paramIndex++}::jsonb`);
            values.push(JSON.stringify(args.metadata));
          }

          if (columns.length > 0) {
            query += `, ${columns.join(', ')}`;
          }
          query += `) VALUES ($1::vector`;

          if (valuePlaceholders.length > 0) {
            query += `, ${valuePlaceholders.join(', ')}`;
          }

          query += `)`;

          await client.query(query, values);
          await client.release();

          Logger.info(`✅ Vecteur inséré dans ${args.tableName}`);
          return `✅ Vecteur inséré dans ${args.schema}.${args.tableName}\n` +
                 `   Dimensions: ${args.vector.length}` +
                 (args.content ? `\n   Content: ${args.content.substring(0, 50)}...` : '') +
                 (args.metadata ? `\n   Metadata: ${Object.keys(args.metadata).length} champs` : '');
        } catch (error: any) {
          Logger.error('❌ [pgvector_insert_vector]', error.message);
          return this.formatError(error, 'Erreur');
        }
      },
    });

    // Outil spécial pour LLM: insertion avec vecteur généré par embedding
    this.server.addTool({
      name: 'pgvector_insert_with_embedding',
      description: `🤖 OUTIL POUR AGENTS LLM: Insère des données avec un vecteur EMBEDDING GÉNÉRÉ AUTOMATIQUEMENT.

Génère un embedding réel basé sur le contenu textuel (llm_interpretation, study_name, etc.).
Utilise l'EmbeddingService (OpenAI ou mode mock).

Colonnes supportées: symbol, study_name, technical_data, llm_interpretation, sentiment, source_type`,
      parameters: z.object({
        tableName: z.string().describe('Nom de la table (ex: sierra_embeddings)'),
        dimensions: z.number().optional().default(1536).describe('Dimensions du vecteur (1536 pour OpenAI)'),
        schema: z.string().optional().default('public').describe('Schéma de la table'),
        vectorColumn: z.string().optional().default('embedding').describe('Nom de la colonne vectorielle'),
        // Colonnes spécifiques sierra_embeddings
        symbol: z.string().optional().describe('Symbole (ex: ETHUSD-BMEX)'),
        study_name: z.string().optional().describe('Nom de l\'étude (ex: MACD, RSI)'),
        technical_data: z.record(z.any()).optional().describe('Données techniques en JSON'),
        llm_interpretation: z.string().optional().describe('Interprétation LLM du signal'),
        sentiment: z.enum(['BULLISH', 'BEARISH', 'NEUTRAL']).optional().describe('Sentiment du marché'),
        source_type: z.enum(['algo', 'llm']).optional().default('llm').describe('Source: algo ou llm'),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();
          const fullTableName = `"${args.schema}"."${args.tableName}"`;

          // Construire le texte pour l'embedding
          const textParts: string[] = [];
          if (args.llm_interpretation) textParts.push(args.llm_interpretation);
          if (args.study_name) textParts.push(`Study: ${args.study_name}`);
          if (args.symbol) textParts.push(`Symbol: ${args.symbol}`);
          if (args.technical_data) textParts.push(`Technical: ${JSON.stringify(args.technical_data)}`);

          const embeddingText = textParts.join(' | ') || 'No content provided';

          // Générer l'embedding via EmbeddingService
          Logger.info(`🔄 Génération embedding pour: "${embeddingText.substring(0, 50)}..."`);
          const embedding = await embeddingService.generateEmbedding(embeddingText, {
            dimensions: args.dimensions
          });
          Logger.info(`✅ Embedding généré: ${embedding.length} dimensions`);

          // Construire dynamiquement les colonnes et valeurs
          const columns: string[] = [args.vectorColumn];
          const valueParts: string[] = [];
          const values: any[] = [];
          let paramIndex = 1;

          // Le vecteur embedding
          valueParts.push(`$${paramIndex++}::vector`);
          values.push(`[${embedding.join(',')}]`);

          // Ajouter les colonnes optionnelles
          if (args.symbol !== undefined) {
            columns.push('symbol');
            valueParts.push(`$${paramIndex++}`);
            values.push(args.symbol);
          }

          if (args.study_name !== undefined) {
            columns.push('study_name');
            valueParts.push(`$${paramIndex++}`);
            values.push(args.study_name);
          }

          if (args.technical_data !== undefined) {
            columns.push('technical_data');
            valueParts.push(`$${paramIndex++}::jsonb`);
            values.push(JSON.stringify(args.technical_data));
          }

          if (args.llm_interpretation !== undefined) {
            columns.push('llm_interpretation');
            valueParts.push(`$${paramIndex++}`);
            values.push(args.llm_interpretation);
          }

          if (args.sentiment !== undefined) {
            columns.push('sentiment');
            valueParts.push(`$${paramIndex++}`);
            values.push(args.sentiment);
          }

          if (args.source_type !== undefined) {
            columns.push('source_type');
            valueParts.push(`$${paramIndex++}`);
            values.push(args.source_type);
          }

          const query = `
            INSERT INTO ${fullTableName} (${columns.join(', ')})
            VALUES (${valueParts.join(', ')})
            RETURNING id
          `;

          const result = await client.query(query, values);
          client.release();

          const insertedId = result.rows[0]?.id;

          Logger.info(`✅ [pgvector_insert_with_embedding] ID: ${insertedId}`);

          let output = `✅ **Données insérées avec embedding**\n\n`;
          output += `📊 Table: ${args.schema}.${args.tableName}\n`;
          output += `🆔 ID: ${insertedId}\n`;
          output += `🧠 Embedding: ${args.dimensions} dimensions (basé sur: "${embeddingText.substring(0, 50)}...")\n\n`;

          if (args.symbol) output += `   Symbol: ${args.symbol}\n`;
          if (args.study_name) output += `   Study: ${args.study_name}\n`;
          if (args.sentiment) output += `   Sentiment: ${args.sentiment}\n`;
          if (args.llm_interpretation) output += `   Interpretation: ${args.llm_interpretation.substring(0, 100)}...\n`;

          return output;
        } catch (error: any) {
          Logger.error('❌ [pgvector_insert_with_embedding]', error.message);
          return this.formatError(error, 'Insertion avec vecteur auto');
        }
      },
    });
  }

  // ========================================================================
  // 4. Recherche de similarité vectorielle
  // ========================================================================
  private vectorSearch(): void {
    this.server.addTool({
      name: 'pgvector_search',
      description: 'Recherche les vecteurs les plus similaires (nearest neighbors)',
      parameters: z.object({
        tableName: z.string().describe('Nom de la table'),
        vectorColumn: z.string().optional().default('embedding').describe('Nom de la colonne vectorielle'),
        queryVector: z.array(z.number()).optional().describe('Vecteur de requête'),
        useRandomVector: z.boolean().optional().default(false).describe('TESTS UNIQUEMENT: Génère un vecteur aléatoire pour tester les performances (ne pas utiliser pour la recherche réelle)'),
        dimensions: z.number().optional().default(1536).describe('Dimensions du vecteur (1536 pour OpenAI)'),
        schema: z.string().optional().default('public').describe('Schéma de la table'),
        topK: z.number().optional().default(5).describe('Nombre de résultats à retourner'),
        distanceMetric: z.enum(['<=>', '<->', '<#>']).optional().default('<=>').describe('Métrique de distance: <=> (cosine), <-> (L2), <#> (inner product)'),
        selectColumns: z.string().optional().default('*').describe('Colonnes à sélectionner (ex: id, content, metadata)'),
        whereClause: z.string().optional().describe('Clause WHERE additionnelle (ex: category = \'docs\')'),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();

          // Générer un vecteur aléatoire si demandé
          let queryVector: number[];
          let isRandom = false;

          if (args.useRandomVector) {
            // Générer un vecteur aléatoire normalisé
            queryVector = [];
            for (let i = 0; i < args.dimensions; i++) {
              // Générer des valeurs aléatoires entre -1 et 1
              queryVector.push((Math.random() * 2) - 1);
            }
            isRandom = true;
          } else if (!args.queryVector) {
            return '❌ Erreur: Vous devez fournir soit queryVector, soit activer useRandomVector';
          } else {
            queryVector = args.queryVector;
          }

          const vectorString = `[${queryVector.join(',')}]`;
          const fullTableName = `"${args.schema}"."${args.tableName}"`;

          // Nom de la métrique pour l'affichage
          const metricNames: Record<string, string> = {
            '<=>': 'Cosine Distance',
            '<->': 'L2 Distance (Euclidean)',
            '<#>': 'Negative Inner Product'
          };

          let query = `SELECT ${args.selectColumns}, 1 - (${args.vectorColumn} ${args.distanceMetric} '${vectorString}'::vector) as similarity\n`;
          query += `FROM ${fullTableName}\n`;
          query += `ORDER BY ${args.vectorColumn} ${args.distanceMetric} '${vectorString}'::vector\n`;
          query += `LIMIT ${args.topK}`;

          if (args.whereClause) {
            query = query.replace(`FROM ${fullTableName}`, `FROM ${fullTableName} WHERE ${args.whereClause}`);
          }

          const startTime = Date.now();
          const result = await client.query(query);
          const duration = Date.now() - startTime;

          await client.release();

          let output = `🔍 **Recherche vectorielle**\n`;
          if (isRandom) {
            output += `🎲 **Mode: Vecteur aléatoire (TESTS UNIQUEMENT)** (${args.dimensions} dimensions)\n`;
            output += `⚠️ Pour la recherche réelle, utilisez intelligent_search ou fournissez queryVector\n`;
          } else {
            output += `🎯 **Mode: Vecteur fourni** (${args.dimensions} dimensions)\n`;
          }
          output += `📊 Métrique: ${metricNames[args.distanceMetric]}\n`;
          output += `🎯 Top-K: ${args.topK}\n`;
          output += `⏱️ Durée: ${duration}ms\n`;
          output += `📈 Résultats: ${result.rows.length}\n\n`;

          if (result.rows.length > 0) {
            result.rows.forEach((row: any, index: number) => {
              output += `**${index + 1}.** Similarité: ${(row.similarity * 100).toFixed(2)}%\n`;
              // Afficher les colonnes sélectionnées (sauf similarity)
              Object.keys(row).forEach(key => {
                if (key !== 'similarity' && key !== args.vectorColumn) {
                  const val = row[key];
                  if (val !== null && val !== undefined) {
                    const displayVal = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
                    if (displayVal.length < 100) {
                      output += `   ${key}: ${displayVal}\n`;
                    } else {
                      output += `   ${key}: ${displayVal.substring(0, 100)}...\n`;
                    }
                  }
                }
              });
              output += '\n';
            });
          } else {
            output += 'Aucun résultat trouvé\n';
          }

          return output;
        } catch (error: any) {
          Logger.error('❌ [pgvector_search]', error.message);
          return this.formatError(error, 'Erreur');
        }
      },
    });
  }

  // ========================================================================
  // 5. Générer un vecteur aléatoire
  // ========================================================================
  private generateRandomVector(): void {
    this.server.addTool({
      name: 'pgvector_generate_random',
      description: 'Génère un vecteur aléatoire pour tests et expérimentation',
      parameters: z.object({
        dimensions: z.number().optional().default(1536).describe('Dimensions du vecteur (1536 pour OpenAI)'),
        min: z.number().optional().default(-1).describe('Valeur minimale'),
        max: z.number().optional().default(1).describe('Valeur maximale'),
        normalize: z.boolean().optional().default(true).describe('Normaliser le vecteur (recommandé pour cosine)'),
      }),
      execute: async (args) => {
        try {
          // Générer un vecteur aléatoire
          let vector: number[] = [];
          for (let i = 0; i < args.dimensions; i++) {
            const value = args.min + (Math.random() * (args.max - args.min));
            vector.push(value);
          }

          // Normaliser si demandé
          if (args.normalize) {
            const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
            if (magnitude > 0) {
              vector = vector.map(val => val / magnitude);
            }
          }

          let output = `🎲 **Vecteur aléatoire généré**\n\n`;
          output += `📐 Dimensions: ${args.dimensions}\n`;
          output += `📊 Plage: [${args.min}, ${args.max}]\n`;
          output += `⚖️ Normalisé: ${args.normalize ? 'Oui ✅' : 'Non ❌'}\n\n`;

          // Afficher les premières valeurs
          output += `🔢 **Premières 10 valeurs:**\n`;
          output += `[${vector.slice(0, 10).map(v => v.toFixed(6)).join(', ')}]\n\n`;

          // Afficher la magnitude
          const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
          output += `📏 Magnitude: ${magnitude.toFixed(6)}\n\n`;

          // Afficher l'utilisation
          output += `💡 **Utilisation:**\n`;
          output += `Utilisez ce vecteur avec l'outil \`pgvector_search\`:\n\n`;
          output += `\`\`\`json\n`;
          output += `{\n`;
          output += `  "tableName": "ma_table",\n`;
          output += `  "queryVector": [${vector.slice(0, 20).join(', ')}, ...],\n`;
          output += `  "topK": 5\n`;
          output += `}\n`;
          output += `\`\`\`\n\n`;
          output += `Ou utilisez directement avec \`useRandomVector: true\`:\n\n`;
          output += `\`\`\`json\n`;
          output += `{\n`;
          output += `  "tableName": "ma_table",\n`;
          output += `  "useRandomVector": true,\n`;
          output += `  "dimensions": ${args.dimensions},\n`;
          output += `  "topK": 5\n`;
          output += `}\n`;
          output += `\`\`\`\n`;

          return output;
        } catch (error: any) {
          Logger.error('❌ [pgvector_generate_random]', error.message);
          return this.formatError(error, 'Erreur');
        }
      },
    });
  }

  // ========================================================================
  // 6. Créer un index vectoriel (HNSW ou IVFFlat)
  // ========================================================================
  private createVectorIndex(): void {
    this.server.addTool({
      name: 'pgvector_create_index',
      description: 'Crée un index sur une colonne vectorielle pour accélérer les recherches',
      parameters: z.object({
        tableName: z.string().describe('Nom de la table'),
        vectorColumn: z.string().optional().default('embedding').describe('Nom de la colonne vectorielle'),
        schema: z.string().optional().default('public').describe('Schéma de la table'),
        indexType: z.enum(['hnsw', 'ivfflat']).optional().default('hnsw').describe('Type d\'index: hnsw (rapide, précis) ou ivfflat (moins précis, plus compact)'),
        indexName: z.string().optional().describe('Nom de l\'index (généré automatiquement si omis)'),
        distanceMetric: z.enum(['vector_cosine_ops', 'vector_l2_ops', 'vector_ip_ops']).optional().default('vector_cosine_ops').describe('Opérateur de distance'),
        hnswM: z.number().optional().default(16).describe('Paramètre HNSW: m (connexions par noeud, 16-64)'),
        hnswEfConstruction: z.number().optional().default(64).describe('Paramètre HNSW: ef_construction (40-400)'),
        ivfflatLists: z.number().optional().describe('Paramètre IVFFlat: lists (autocalculé si omis: rows/1000)'),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();

          // Générer le nom de l'index
          const indexName = args.indexName || `${args.tableName}_${args.vectorColumn}_${args.indexType}_idx`;

          let indexSQL = `CREATE INDEX IF NOT EXISTS ${indexName} ON "${args.schema}"."${args.tableName}" `;

          if (args.indexType === 'hnsw') {
            indexSQL += `USING hnsw (${args.vectorColumn} ${args.distanceMetric}) `;
            indexSQL += `WITH (m = ${args.hnswM}, ef_construction = ${args.hnswEfConstruction})`;
          } else {
            indexSQL += `USING ivfflat (${args.vectorColumn} ${args.distanceMetric})`;
            if (args.ivfflatLists) {
              indexSQL += ` WITH (lists = ${args.ivfflatLists})`;
            }
          }

          const startTime = Date.now();
          await client.query(indexSQL);
          const duration = Date.now() - startTime;

          await client.release();

          Logger.info(`✅ Index ${indexName} créé`);
          return `✅ Index vectoriel créé:\n` +
                 `   Nom: ${indexName}\n` +
                 `   Table: ${args.schema}.${args.tableName}\n` +
                 `   Colonne: ${args.vectorColumn}\n` +
                 `   Type: ${args.indexType.toUpperCase()}\n` +
                 `   Métrique: ${args.distanceMetric}\n` +
                 `   Durée de création: ${duration}ms\n\n` +
                 `💡 HNSW est recommandé pour la plupart des cas d'usage`;
        } catch (error: any) {
          Logger.error('❌ [pgvector_create_index]', error.message);
          return this.formatError(error, 'Erreur');
        }
      },
    });
  }

  // ========================================================================
  // 6. Supprimer des vecteurs
  // ========================================================================
  private deleteVectors(): void {
    this.server.addTool({
      name: 'pgvector_delete',
      description: 'Supprime des vecteurs d\'une table',
      parameters: z.object({
        tableName: z.string().describe('Nom de la table'),
        schema: z.string().optional().default('public').describe('Schéma de la table'),
        whereClause: z.string().describe('Clause WHERE pour identifier les vecteurs à supprimer (ex: id = 1)'),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();

          const fullTableName = `"${args.schema}"."${args.tableName}"`;

          // Compter les lignes avant suppression
          const countResult = await client.query(`SELECT COUNT(*) as count FROM ${fullTableName}`);
          const beforeCount = parseInt(countResult.rows[0].count);

          // Supprimer
          await client.query(`DELETE FROM ${fullTableName} WHERE ${args.whereClause}`);

          // Compter après
          const afterCountResult = await client.query(`SELECT COUNT(*) as count FROM ${fullTableName}`);
          const afterCount = parseInt(afterCountResult.rows[0].count);

          await client.release();

          const deletedCount = beforeCount - afterCount;
          Logger.info(`✅ ${deletedCount} vecteur(s) supprimé(s) de ${args.tableName}`);

          return `✅ Suppression effectuée:\n` +
                 `   Table: ${args.schema}.${args.tableName}\n` +
                 `   Condition: ${args.whereClause}\n` +
                 `   Vecteurs supprimés: ${deletedCount}\n` +
                 `   Restants: ${afterCount}`;
        } catch (error: any) {
          Logger.error('❌ [pgvector_delete]', error.message);
          return this.formatError(error, 'Erreur');
        }
      },
    });
  }

  // ========================================================================
  // 7. Statistiques sur les vecteurs
  // ========================================================================
  private vectorStats(): void {
    this.server.addTool({
      name: 'pgvector_stats',
      description: 'Affiche des statistiques sur les colonnes vectorielles d\'une table',
      parameters: z.object({
        tableName: z.string().describe('Nom de la table'),
        vectorColumn: z.string().optional().default('embedding').describe('Nom de la colonne vectorielle'),
        schema: z.string().optional().default('public').describe('Schéma de la table'),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();

          const fullTableName = `"${args.schema}"."${args.tableName}"`;

          // Nombre de vecteurs
          const countResult = await client.query(`
            SELECT COUNT(*) as count, COUNT(${args.vectorColumn}) as vector_count
            FROM ${fullTableName}
          `);

          // Informations sur la colonne
          const columnInfo = await client.query(`
            SELECT
              data_type,
              udt_name
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
          `, [args.schema, args.tableName, args.vectorColumn]);

          // Index sur cette colonne
          const indexInfo = await client.query(`
            SELECT
              indexname,
              indexdef
            FROM pg_indexes
            WHERE schemaname = $1 AND tablename = $2
              AND indexdef LIKE '%${args.vectorColumn}%'
          `, [args.schema, args.tableName]);

          await client.release();

          let output = `📊 **Statistiques vectorielles**\n\n`;
          output += `Table: ${args.schema}.${args.tableName}\n`;
          output += `Colonne: ${args.vectorColumn}\n\n`;

          if (columnInfo.rows.length === 0) {
            output += `❌ Colonne vectorielle non trouvée`;
            return output;
          }

          output += `**Type:** ${columnInfo.rows[0].udt_name}\n`;
          output += `**Total lignes:** ${countResult.rows[0].count}\n`;
          output += `**Vecteurs non-NULL:** ${countResult.rows[0].vector_count}\n`;

          const nullCount = parseInt(countResult.rows[0].count) - parseInt(countResult.rows[0].vector_count);
          if (nullCount > 0) {
            output += `⚠️ **Vecteurs NULL:** ${nullCount}\n`;
          }

          output += `\n`;

          if (indexInfo.rows.length > 0) {
            output += `**Index vectoriels (${indexInfo.rows.length}):**\n`;
            indexInfo.rows.forEach((idx: any) => {
              output += `• ${idx.indexname}\n`;
            });
          } else {
            output += `⚠️ **Aucun index vectoriel** - Les recherches seront lentes\n`;
            output += `💡 Utilisez pgvector_create_index pour créer un index HNSW ou IVFFlat\n`;
          }

          return output;
        } catch (error: any) {
          Logger.error('❌ [pgvector_stats]', error.message);
          return this.formatError(error, 'Erreur');
        }
      },
    });
  }

  // ========================================================================
  // 8. Lister les tables avec colonnes vectorielles
  // ========================================================================
  private listVectorTables(): void {
    this.server.addTool({
      name: 'pgvector_list_tables',
      description: 'Liste toutes les tables qui contiennent des colonnes vectorielles',
      parameters: z.object({
        schema: z.string().optional().default('public').describe('Schéma à explorer'),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();

          const result = await client.query(`
            SELECT
              t.table_name,
              c.column_name,
              c.udt_name,
              c.character_maximum_length
            FROM information_schema.columns c
            JOIN information_schema.tables t
              ON c.table_name = t.table_name AND c.table_schema = t.table_schema
            WHERE c.table_schema = $1
              AND c.udt_name = 'vector'
            ORDER BY t.table_name, c.column_name
          `, [args.schema]);

          await client.release();

          if (result.rows.length === 0) {
            return `📋 Aucune table avec colonnes vectorielles trouvée dans le schéma '${args.schema}'\n\n` +
                   `💡 Utilisez pgvector_create_column pour ajouter une colonne vectorielle`;
          }

          let output = `📋 **Tables avec colonnes vectorielles (${result.rows.length})**\n\n`;

          result.rows.forEach((row: any, index: number) => {
            output += `${index + 1}. ${args.schema}.${row.table_name}\n`;
            output += `   Colonne: ${row.column_name}\n`;
            output += `   Type: ${row.udt_name}${row.character_maximum_length ? `(${row.character_maximum_length})` : ''}\n\n`;
          });

          return output;
        } catch (error: any) {
          Logger.error('❌ [pgvector_list_tables]', error.message);
          return this.formatError(error, 'Erreur');
        }
      },
    });
  }

  // ========================================================================
  // 9. Insertion en lot de vecteurs
  // ========================================================================
  private batchInsertVectors(): void {
    this.server.addTool({
      name: 'pgvector_batch_insert',
      description: 'Insère plusieurs vecteurs en une seule requête (plus performant)',
      parameters: z.object({
        tableName: z.string().describe('Nom de la table'),
        vectorColumn: z.string().optional().default('embedding').describe('Nom de la colonne vectorielle'),
        vectors: z.array(z.object({
          vector: z.array(z.number()).describe('Tableau de nombres représentant le vecteur'),
          content: z.string().optional().describe('Contenu textuel associé'),
          metadata: z.record(z.any()).optional().describe('Métadonnées JSON'),
        })).describe('Tableau de vecteurs avec leurs données associées'),
        schema: z.string().optional().default('public').describe('Schéma de la table'),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();

          const fullTableName = `"${args.schema}"."${args.tableName}"`;

          // Vérifier que tous les vecteurs ont les mêmes champs optionnels
          const hasContent = args.vectors.every(v => v.content !== undefined);
          const hasMetadata = args.vectors.every(v => v.metadata !== undefined);

          // Colonnes de la requête (uniquement si tous ont les champs)
          const columns = [args.vectorColumn];
          if (hasContent) columns.push('content');
          if (hasMetadata) columns.push('metadata');

          // Construire VALUES et les paramètres
          const valuesPlaceholders: string[] = [];
          const queryParams: any[] = [];
          let paramIndex = 1;

          for (const item of args.vectors) {
            // Ajouter le vecteur
            const vectorStr = `[${item.vector.join(',')}]`;
            queryParams.push(vectorStr);
            let placeholders = `($${paramIndex++}::vector`;

            // Ajouter content uniquement si tous les vecteurs l'ont
            if (hasContent) {
              queryParams.push(item.content!);
              placeholders += `, $${paramIndex++}`;
            }

            // Ajouter metadata uniquement si tous les vecteurs l'ont
            if (hasMetadata) {
              queryParams.push(JSON.stringify(item.metadata!));
              placeholders += `, $${paramIndex++}::jsonb`;
            }

            placeholders += ')';
            valuesPlaceholders.push(placeholders);
          }

          const query = `INSERT INTO ${fullTableName} (${columns.join(', ')}) VALUES ${valuesPlaceholders.join(', ')} RETURNING *`;

          const startTime = Date.now();
          const result = await client.query(query, queryParams);
          const duration = Date.now() - startTime;

          await client.release();

          Logger.info(`✅ ${result.rows.length} vecteurs insérés dans ${args.tableName}`);
          return `✅ Insertion en lot réussie:\n` +
                 `   Table: ${args.schema}.${args.tableName}\n` +
                 `   Vecteurs insérés: ${result.rows.length}\n` +
                 `   Colonnes: ${columns.join(', ')}\n` +
                 `   Durée: ${duration}ms\n` +
                 `   Moyenne: ${(duration / result.rows.length).toFixed(2)}ms/vecteur`;
        } catch (error: any) {
          Logger.error('❌ [pgvector_batch_insert]', error.message);
          return this.formatError(error, 'Erreur');
        }
      },
    });
  }

  // ========================================================================
  // 10. Mettre à jour un vecteur
  // ========================================================================
  private updateVector(): void {
    this.server.addTool({
      name: 'pgvector_update',
      description: 'Met à jour un vecteur existant',
      parameters: z.object({
        tableName: z.string().describe('Nom de la table'),
        vectorColumn: z.string().optional().default('embedding').describe('Nom de la colonne vectorielle'),
        vector: z.array(z.number()).describe('Nouveau vecteur'),
        schema: z.string().optional().default('public').describe('Schéma de la table'),
        whereClause: z.string().describe('Clause WHERE pour identifier la ligne à mettre à jour (ex: id = 1)'),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();

          const vectorString = `[${args.vector.join(',')}]`;
          const fullTableName = `"${args.schema}"."${args.tableName}"`;

          // Utiliser des paramètres pour éviter les injections
          const query = `
            UPDATE ${fullTableName}
            SET ${args.vectorColumn} = $1::vector
            WHERE ${args.whereClause}
            RETURNING *
          `;

          const result = await client.query(query, [vectorString]);
          await client.release();

          if (result.rows.length === 0) {
            return `⚠️ Aucune ligne mise à jour - Vérifiez votre clause WHERE: ${args.whereClause}`;
          }

          Logger.info(`✅ Vecteur mis à jour dans ${args.tableName}`);
          return `✅ Vecteur mis à jour:\n` +
                 `   Table: ${args.schema}.${args.tableName}\n` +
                 `   Colonne: ${args.vectorColumn}\n` +
                 `   Lignes affectées: ${result.rows.length}\n` +
                 `   Nouvelles dimensions: ${args.vector.length}`;
        } catch (error: any) {
          Logger.error('❌ [pgvector_update]', error.message);
          return this.formatError(error, 'Mise à jour de vecteur');
        }
      },
    });
  }

  // ========================================================================
  // 11. Valider des vecteurs avant insertion
  // ========================================================================
  private validateVectors(): void {
    this.server.addTool({
      name: 'pgvector_validate',
      description: 'Valide un ensemble de vecteurs avant insertion (vérifie dimensions, cohérence, compatibilité table)',
      parameters: z.object({
        vectors: z.array(z.object({
          vector: z.array(z.number()).describe('Tableau de nombres représentant le vecteur'),
        })).describe('Vecteurs à valider'),
        tableName: z.string().optional().describe('Nom de la table pour vérifier la compatibilité'),
        vectorColumn: z.string().optional().default('embedding').describe('Nom de la colonne vectorielle'),
        schema: z.string().optional().default('public').describe('Schéma de la table'),
        strictMode: z.boolean().optional().default(false).describe('Échoue rapidement dès la première erreur'),
      }),
      execute: async (args) => {
        try {
          const issues: string[] = [];
          const suggestions: string[] = [];
          let compatible = true;

          // Vérifier que la liste n'est pas vide
          if (args.vectors.length === 0) {
            return `❌ **Validation échouée**\n\n❌ Aucun vecteur à valider`;
          }

          // Récupérer les dimensions attendues depuis la table si spécifiée
          let expectedDimensions: number | null = null;
          if (args.tableName) {
            try {
              const client = await this.pool.connect();
              const colResult = await client.query(`
                SELECT character_maximum_length
                FROM information_schema.columns
                WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
              `, [args.schema, args.tableName, args.vectorColumn]);

              if (colResult.rows.length > 0) {
                expectedDimensions = parseInt(colResult.rows[0].character_maximum_length);
              }
              await client.release();
            } catch (e) {
              // Ignorer les erreurs lors de la récupération des dimensions
            }
          }

          // Analyser les dimensions
          const dimensionsSet = new Set<number>();
          const nullVectors: number[] = [];
          const nanVectors: number[] = [];
          const infVectors: number[] = [];

          args.vectors.forEach((item, index) => {
            const vec = item.vector;

            // Vérifier vecteur vide
            if (vec.length === 0) {
              nullVectors.push(index);
              issues.push(`Vecteur #${index + 1}: vide`);
              return;
            }

            dimensionsSet.add(vec.length);

            // Vérifier valeurs invalides
            vec.forEach((val, i) => {
              if (isNaN(val)) nanVectors.push(index);
              if (!isFinite(val)) infVectors.push(index);
            });
          });

          // Vérifier cohérence des dimensions
          if (dimensionsSet.size > 1) {
            compatible = false;
            issues.push(`⚠️ Dimensions incohérentes: ${Array.from(dimensionsSet).join(', ')}D`);
            suggestions.push(`Tous les vecteurs doivent avoir la même dimension`);
          }

          // Vérifier NaN
          if (nanVectors.length > 0) {
            compatible = false;
            issues.push(`⚠️ NaN détecté dans ${nanVectors.length} vecteur(s)`);
            suggestions.push(`Remplacez les valeurs NaN par 0 ou une valeur par défaut`);
          }

          // Vérifier Inf
          if (infVectors.length > 0) {
            compatible = false;
            issues.push(`⚠️ Infinite détecté dans ${infVectors.length} vecteur(s)`);
            suggestions.push(`Les valeurs infinies ne sont pas supportées`);
          }

          // Vérifier vecteurs vides
          if (nullVectors.length > 0) {
            compatible = false;
            issues.push(`⚠️ ${nullVectors.length} vecteur(s) vide(s)`);
          }

          // Vérifier compatibilité avec la table
          if (expectedDimensions !== null) {
            const dimensionsArray = Array.from(dimensionsSet);
            if (dimensionsArray.length > 0) {
              const actualDimensions = dimensionsArray[0];
              if (actualDimensions !== expectedDimensions) {
                compatible = false;
                issues.push(`⚠️ Dimensions incompatibles avec la table: ${actualDimensions}D ≠ ${expectedDimensions}D attendus`);
                suggestions.push(`Utilisez des vecteurs de ${expectedDimensions} dimensions pour la table ${args.schema}.${args.tableName}`);
              }
            } else {
              // Aucune dimension valide trouvée (vecteurs vides)
              compatible = false;
              issues.push(`Impossible de déterminer les dimensions (vecteurs vides ou invalides)`);
            }
          }

          // Construire le rapport
          let output = `📋 **Rapport de Validation**\n\n`;
          output += `📊 Vecteurs analysés: ${args.vectors.length}\n`;

          const dimensionsArray = Array.from(dimensionsSet);
          if (dimensionsArray.length > 0) {
            output += `📏 Dimensions trouvées: ${dimensionsArray.join(', ')}D\n\n`;
          } else {
            output += `📏 Dimensions trouvées: Aucune (vecteurs vides)\n\n`;
          }

          output += `✅ **Compatible:** ${compatible ? 'OUI' : 'NON'}\n\n`;

          if (issues.length > 0) {
            output += `❌ **Problèmes (${issues.length}):**\n`;
            issues.forEach(issue => output += `   ${issue}\n`);
            output += `\n`;
          }

          if (suggestions.length > 0) {
            output += `💡 **Suggestions:**\n`;
            suggestions.forEach(sug => output += `   • ${sug}\n`);
            output += `\n`;
          }

          if (compatible) {
            output += `🎉 **Tous les vecteurs sont valides !**\n\n`;
            if (args.tableName) {
              output += `📌 Prêt pour l'insertion dans ${args.schema}.${args.tableName}\n`;
            }
          } else if (args.strictMode) {
            output += `\n🚫 **Mode strict: Validation échouée**`;
          } else {
            output += `\n⚠️ Corrigez les problèmes avant insertion`;
          }

          return output;
        } catch (error: any) {
          Logger.error('❌ [pgvector_validate]', error.message);
          return this.formatError(error, 'Validation de vecteurs');
        }
      },
    });
  }

  // ========================================================================
  // 12. Normaliser un vecteur
  // ========================================================================
  private normalizeVector(): void {
    this.server.addTool({
      name: 'pgvector_normalize',
      description: 'Normalise un vecteur pour améliorer les recherches de similarité',
      parameters: z.object({
        vector: z.array(z.number()).describe('Vecteur à normaliser'),
        method: z.enum(['l2', 'max', 'minmax', 'sum']).optional().default('l2').describe('Méthode de normalisation: l2 (euclidienne), max (max value), minmax (0-1), sum (sum=1)'),
        decimals: z.number().optional().default(6).describe('Nombre de décimales à conserver'),
      }),
      execute: async (args) => {
        try {
          const vec = [...args.vector];
          const n = vec.length;
          let result: number[];

          switch (args.method) {
            case 'l2': {
              // Normalisation L2 (euclidienne)
              const sumSquares = vec.reduce((sum, val) => sum + val * val, 0);
              const norm = Math.sqrt(sumSquares);
              if (norm === 0) {
                return `❌ **Erreur: Impossible de normaliser**\n\nLa norme L2 est 0 (vecteur nul)`;
              }
              result = vec.map(val => val / norm);
              break;
            }
            case 'max': {
              // Normalisation par max
              const maxVal = Math.max(...vec.map(Math.abs));
              if (maxVal === 0) {
                return `❌ **Erreur: Impossible de normaliser**\n\nLe maximum est 0 (vecteur nul)`;
              }
              result = vec.map(val => val / maxVal);
              break;
            }
            case 'minmax': {
              // Normalisation MinMax [0,1]
              const minVal = Math.min(...vec);
              const maxVal = Math.max(...vec);
              const range = maxVal - minVal;
              if (range === 0) {
                return `❌ **Erreur: Impossible de normaliser**\n\nLe range est 0 (toutes les valeurs identiques)`;
              }
              result = vec.map(val => (val - minVal) / range);
              break;
            }
            case 'sum': {
              // Normalisation par somme (sum = 1)
              const sum = vec.reduce((s, val) => s + Math.abs(val), 0);
              if (sum === 0) {
                return `❌ **Erreur: Impossible de normaliser**\n\nLa somme est 0 (vecteur nul)`;
              }
              result = vec.map(val => val / sum);
              break;
            }
            default:
              result = vec;
          }

          // Arrondir
          result = result.map(val => {
            const rounded = parseFloat(val.toFixed(args.decimals));
            return rounded;
          });

          // Vérifier la nouvelle norme
          const newNorm = Math.sqrt(result.reduce((sum, val) => sum + val * val, 0));

          let output = `✅ **Vecteur Normalisé**\n\n`;
          output += `📊 Méthode: ${args.method.toUpperCase()}\n`;
          output += `📏 Dimensions: ${n}\n`;
          output += `🎯 Nouvelle norme: ${newNorm.toFixed(6)}\n\n`;

          output += `**Vecteur normalisé:**\n`;
          output += `[${result.slice(0, 10).join(', ')}${n > 10 ? ', ...' : ''}]\n\n`;

          output += `📋 **JSON pour insertion:**\n`;
          output += `\`\`\`json\n${JSON.stringify(result)}\n\`\`\`\n\n`;

          output += `💡 Utilisez ce vecteur avec pgvector_insert_vector ou pgvector_batch_insert`;

          return output;
        } catch (error: any) {
          Logger.error('❌ [pgvector_normalize]', error.message);
          return this.formatError(error, 'Normalisation de vecteur');
        }
      },
    });
  }

  // ========================================================================
  // 13. Diagnostic complet d'une table vectorielle
  // ========================================================================
  private diagnostic(): void {
    this.server.addTool({
      name: 'pgvector_diagnostic',
      description: 'Effectue un diagnostic complet d\'une table vectorielle avec suggestions de correction',
      parameters: z.object({
        tableName: z.string().describe('Nom de la table à diagnostiquer'),
        vectorColumn: z.string().optional().default('embedding').describe('Nom de la colonne vectorielle'),
        schema: z.string().optional().default('public').describe('Schéma de la table'),
        generateFixScript: z.boolean().optional().default(false).describe('Générer un script SQL de correction'),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();
          const fullTableName = `"${args.schema}"."${args.tableName}"`;
          const issues: string[] = [];
          const suggestions: string[] = [];
          const fixScripts: string[] = [];

          let output = `🔍 **Diagnostic: ${args.schema}.${args.tableName}**\n\n`;

          // 1. Vérifier que la table existe
          const tableCheck = await client.query(`
            SELECT EXISTS(
              SELECT 1 FROM information_schema.tables
              WHERE table_schema = $1 AND table_name = $2
            ) as exists
          `, [args.schema, args.tableName]);

          if (!tableCheck.rows[0].exists) {
            await client.release();
            output += `❌ **Table non trouvée**\n\n`;
            output += `💡 **Suggestion:**\n`;
            output += `   Créez la table avec pgvector_create_column:\n`;
            output += `   \`\`\`\n`;
            output += `   tableName: "${args.tableName}"\n`;
            output += `   dimensions: 1536  # ou vos dimensions\n`;
            output += `   createTable: true\n`;
            output += `   \`\`\`\n`;
            return output;
          }

          output += `✅ Table existe\n\n`;

          // 2. Vérifier la colonne vectorielle
          const colCheck = await client.query(`
            SELECT
              data_type,
              udt_name,
              character_maximum_length,
              is_nullable
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
          `, [args.schema, args.tableName, args.vectorColumn]);

          if (colCheck.rows.length === 0) {
            issues.push(`Colonne vectorielle "${args.vectorColumn}" non trouvée`);
            suggestions.push(`Créez la colonne avec pgvector_create_column`);
            fixScripts.push(`ALTER TABLE ${fullTableName} ADD COLUMN ${args.vectorColumn} vector(1536);`);
          } else {
            const colInfo = colCheck.rows[0];
            output += `✅ Colonne vectorielle: ${colInfo.udt_name}(${colInfo.character_maximum_length}D)\n`;
            output += `   Nullable: ${colInfo.is_nullable}\n\n`;

            // Vérifier les dimensions standards
            const dims = parseInt(colInfo.character_maximum_length);
            const standardModels: Record<number, string> = {
              1536: 'OpenAI text-embedding-ada-002',
              3072: 'OpenAI text-embedding-3-large',
              384: 'Sentence Transformers (all-MiniLM-L6-v2)'
            };
            if (standardModels[dims]) {
              output += `💡 Correspond probablement à: ${standardModels[dims]}\n\n`;
            }
          }

          // 3. Vérifier les colonnes support (content, metadata)
          const supportColumns = await client.query(`
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
              AND column_name IN ('content', 'metadata', 'id')
            ORDER BY column_name
          `, [args.schema, args.tableName]);

          if (supportColumns.rows.length > 0) {
            output += `📋 Colonnes support trouvées:\n`;
            supportColumns.rows.forEach((col: any) => {
              output += `   • ${col.column_name}: ${col.data_type}\n`;
            });
            output += `\n`;
          } else {
            output += `⚠️ Aucune colonne support (content, metadata, id)\n\n`;
          }

          // 4. Compter les vecteurs
          const countResult = await client.query(`
            SELECT
              COUNT(*) as total,
              COUNT(${args.vectorColumn}) as with_vector,
              COUNT(*) - COUNT(${args.vectorColumn}) as null_vectors
            FROM ${fullTableName}
          `);

          const stats = countResult.rows[0];
          output += `📊 **Statistiques:**\n`;
          output += `   Total lignes: ${stats.total}\n`;
          output += `   Avec vecteur: ${stats.with_vector}\n`;
          if (parseInt(stats.null_vectors) > 0) {
            output += `   ⚠️ Vecteurs NULL: ${stats.null_vectors}\n`;
            issues.push(`${stats.null_vectors} vecteurs NULL détectés`);
          }
          output += `\n`;

          // 5. Vérifier les index
          const indexCheck = await client.query(`
            SELECT
              indexname,
              indexdef
            FROM pg_indexes
            WHERE schemaname = $1 AND tablename = $2
              AND indexdef LIKE '%${args.vectorColumn}%'
          `, [args.schema, args.tableName]);

          if (indexCheck.rows.length === 0) {
            output += `⚠️ **Aucun index vectoriel**\n`;
            output += `   ⚠️ Les recherches seront lentes sans index\n\n`;
            issues.push(`Aucun index vectoriel`);
            suggestions.push(`Créez un index HNSW pour des recherches rapides`);
            fixScripts.push(`CREATE INDEX ${args.tableName}_${args.vectorColumn}_hnsw_idx ON ${fullTableName} USING hnsw (${args.vectorColumn} vector_cosine_ops);`);
          } else {
            output += `✅ **Index vectoriels (${indexCheck.rows.length}):**\n`;
            indexCheck.rows.forEach((idx: any) => {
              output += `   • ${idx.indexname}\n`;
              // Extraire le type d'index
              if (idx.indexdef.includes('hnsw')) {
                output += `     Type: HNSW (rapide)\n`;
              } else if (idx.indexdef.includes('ivfflat')) {
                output += `     Type: IVFFlat (compact)\n`;
              }
            });
            output += `\n`;
          }

          // 6. Vérifier l'extension pgvector
          const extCheck = await client.query(`
            SELECT EXISTS(
              SELECT 1 FROM pg_extension WHERE extname = 'vector'
            ) as installed
          `);

          if (!extCheck.rows[0].installed) {
            issues.push(`Extension pgvector non installée`);
            suggestions.push(`Installez l'extension: CREATE EXTENSION vector;`);
          }

          await client.release();

          // Résumé
          output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          output += `📋 **Résumé:**\n`;

          if (issues.length === 0) {
            output += `\n🎉 **Aucun problème détecté !**\n`;
            output += `La table ${args.schema}.${args.tableName} est prête à l'emploi.\n`;
          } else {
            output += `\n⚠️ **${issues.length} problème(s) détecté(s)**\n\n`;
            output += `**Problèmes:**\n`;
            issues.forEach(issue => output += `   ❌ ${issue}\n`);
            output += `\n`;

            if (suggestions.length > 0) {
              output += `**Suggestions:**\n`;
              suggestions.forEach(sug => output += `   💡 ${sug}\n`);
            }

            // Script de correction
            if (args.generateFixScript && fixScripts.length > 0) {
              output += `\n🔧 **Script de correction SQL:**\n`;
              output += `\`\`\`sql\n`;
              fixScripts.forEach(script => output += script + '\n');
              output += `\`\`\`\n`;
            }
          }

          return output;
        } catch (error: any) {
          Logger.error('❌ [pgvector_diagnostic]', error.message);
          return this.formatError(error, 'Diagnostic');
        }
      },
    });
  }

  // ========================================================================
  // 14. Analyser les requêtes lentes
  // ========================================================================
  private analyzeSlowQueries(): void {
    this.server.addTool({
      name: 'analyze_slow_queries',
      description: 'Analyse les requêtes lentes en utilisant pg_stat_statements (nécessite l\'extension)',
      parameters: z.object({
        limit: z.number().optional().default(20).describe('Nombre de requêtes à afficher'),
        minExecutions: z.number().optional().default(5).describe('Nombre minimum d\'exécutions pour être inclus'),
        orderBy: z.enum(['total_time', 'mean_time', 'calls']).optional().default('total_time').describe('Tri par: total_time, mean_time, ou calls'),
        includeQuery: z.boolean().optional().default(false).describe('Inclure le texte complet des requêtes (peut être long)'),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();

          // Vérifier si pg_stat_statements est installé
          const extCheck = await client.query(`
            SELECT EXISTS(
              SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
            ) as installed
          `);

          if (!extCheck.rows[0].installed) {
            await client.release();
            return `❌ **Extension pg_stat_statements non installée**

Cette extension est requise pour analyser les requêtes lentes.

📦 **Installation:**

\`\`\`sql
-- Activer l'extension (nécessite les droits superuser)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Vérifier
SELECT * FROM pg_extension WHERE extname = 'pg_stat_statements';
\`\`\`

⚙️ **Configuration requise dans postgresql.conf:**

\`\`\`
# Ajouter ou modifier dans postgresql.conf
shared_preload_libraries = 'pg_stat_statements'

# Puis redémarrer PostgreSQL
\`\`\`

💡 **Pourquoi pg_stat_statements?**
- Track les performances de toutes les requêtes SQL
- Identifie les requêtes lentes et fréquemment exécutées
- Aide à optimiser les index et les requêtes`;
          }

          // Vérifier que pg_stat_statements est configuré
          const statsCheck = await client.query(`
            SELECT EXISTS(
              SELECT 1 FROM information_schema.tables
              WHERE table_name = 'pg_stat_statements'
            ) as exists
          `);

          if (!statsCheck.rows[0].exists) {
            await client.release();
            return `⚠️ **pg_stat_statements installé mais non fonctionnel**

L'extension est installée mais la vue pg_stat_statements n'est pas accessible.

🔧 **Solutions possibles:**
1. Vérifiez que shared_preload_libraries inclut pg_stat_statements
2. Redémarrez PostgreSQL
3. Vérifiez les permissions de l'utilisateur

\`\`\`sql
-- Vérifier la configuration
SHOW shared_preload_libraries;
\`\`\``;
          }

          // Récupérer les statistiques
          const orderByMap: Record<string, string> = {
            total_time: 'total_exec_time DESC',
            mean_time: 'mean_exec_time DESC',
            calls: 'calls DESC'
          };

          const query = `
            SELECT
              query,
              calls,
              total_exec_time as total_time,
              mean_exec_time as mean_time,
              max_exec_time as max_time,
              stddev_exec_time as stddev_time,
              rows
            FROM pg_stat_statements
            WHERE calls >= $1
            ORDER BY ${orderByMap[args.orderBy]}
            LIMIT $2
          `;

          const result = await client.query(query, [args.minExecutions, args.limit]);
          await client.release();

          if (result.rows.length === 0) {
            return `📊 **Analyse des Requêtes Lentes**

Aucune requête trouvée avec au moins ${args.minExecutions} exécutions.

💡 Essayez de réduire le paramètre minExecutions.`;
          }

          let output = `📊 **Requêtes Lentes (${result.rows.length} résultats)**\n\n`;
          output += `📈 Trié par: ${args.orderBy}\n`;
          output += `🔢 Min exécutions: ${args.minExecutions}\n\n`;

          result.rows.forEach((row: any, index: number) => {
            const totalTime = (row.total_time || 0).toFixed(2);
            const meanTime = (row.mean_time || 0).toFixed(4);
            const maxTime = (row.max_time || 0).toFixed(4);
            const calls = row.calls || 0;

            output += `**${index + 1}.** ⏱️ Total: ${totalTime}s | Moy: ${meanTime}s | Max: ${maxTime}s | Appels: ${calls}\n`;

            if (args.includeQuery && row.query) {
              let query = row.query;
              if (query.length > 200) {
                query = query.substring(0, 200) + '...';
              }
              output += `   \`\`\`sql\n   ${query}\n   \`\`\`\n`;
            }
            output += `\n`;
          });

          // Suggestions d'optimisation
          output += `💡 **Suggestions d'optimisation:**\n`;
          output += `   • Créez des index sur les colonnes fréquemment filtrées\n`;
          output += `   • Utilisez EXPLAIN ANALYZE pour analyser les requêtes lentes\n`;
          output += `   • Évitez SELECT * dans les requêtes fréquentes\n`;
          output += `   • Utilisez pgvector_create_index pour les recherches vectorielles\n`;

          return output;
        } catch (error: any) {
          Logger.error('❌ [analyze_slow_queries]', error.message);
          return this.formatError(error, 'Analyse des requêtes lentes');
        }
      },
    });
  }

  // ========================================================================
  // 15. Guide de syntaxe pgvector pour LLM
  // ========================================================================
  private pgvectorHelp(): void {
    this.server.addTool({
      name: 'pgvector_help',
      description: `📚 Guide de syntaxe pgvector pour les agents LLM.

IMPORTANT: Utilisez cet outil AVANT d'écrire des requêtes SQL avec des vecteurs!
Retourne la syntaxe correcte pour pgvector (différente des tableaux PostgreSQL classiques).`,
      parameters: z.object({
        topic: z.enum(['all', 'create', 'insert', 'search', 'functions', 'errors']).optional().default('all')
          .describe('Sujet: all, create, insert, search, functions, errors'),
      }),
      execute: async (args) => {
        let output = `📚 **Guide de Syntaxe pgvector pour LLM**\n\n`;

        const topics = {
          create: `## 🔧 Créer une colonne/table vectorielle

\`\`\`sql
-- Créer une table avec vecteurs
CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  content TEXT,
  embedding vector(1536)  -- ⚠️ Pas ARRAY, c'est "vector(dimensions)"
);

-- Ajouter une colonne à une table existante
ALTER TABLE ma_table ADD COLUMN embedding vector(1536);

-- Modifier les dimensions d'une colonne
ALTER TABLE ma_table ALTER COLUMN embedding TYPE vector(384);
\`\`\`
`,

          insert: `## ✏️ Insérer des vecteurs

\`\`\`sql
-- ✅ CORRECT: Format chaîne avec crochets, puis cast ::vector
INSERT INTO documents (content, embedding)
VALUES ('texte', '[0.1, 0.2, 0.3, ...]'::vector);

-- ✅ CORRECT: Avec paramètre $1
INSERT INTO documents (content, embedding)
VALUES ($1, $2::vector);
-- Où $2 = '[0.1, 0.2, 0.3]' (chaîne)

-- ❌ INCORRECT: N'utilisez JAMAIS ces syntaxes
INSERT INTO documents (embedding) VALUES (ARRAY[0.1, 0.2]);  -- FAUX!
INSERT INTO documents (embedding) VALUES (array_to_vector(...));  -- N'EXISTE PAS!
\`\`\`
`,

          search: `## 🔍 Recherche de similarité

### 1. Recherche avec vecteur fourni

\`\`\`sql
-- Distance cosine (le plus courant) - opérateur <=>
SELECT *, 1 - (embedding <=> '[0.1, 0.2, ...]'::vector) as similarity
FROM documents
ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 10;

-- Distance L2 (euclidienne) - opérateur <->
SELECT * FROM documents
ORDER BY embedding <-> '[0.1, 0.2, ...]'::vector
LIMIT 10;

-- Produit scalaire (inner product) - opérateur <#>
SELECT * FROM documents
ORDER BY embedding <#> '[0.1, 0.2, ...]'::vector
LIMIT 10;
\`\`\`

### 2. Recherche avec vecteur aléatoire (🎲 NOUVEAU!)

Utiliser un vecteur aléatoire pour tester votre base de données:

\`\`\`json
// Méthode 1: Utiliser l'option useRandomVector
{
  "tableName": "documents",
  "useRandomVector": true,
  "dimensions": 768,
  "topK": 10,
  "distanceMetric": "<=>"
}

// Méthode 2: Générer puis utiliser un vecteur
// 1. Générer un vecteur aléatoire
{
  "tool": "pgvector_generate_random",
  "dimensions": 768
}

// 2. Utiliser ce vecteur dans la recherche
{
  "tableName": "documents",
  "queryVector": [0.123, -0.456, 0.789, ...],
  "topK": 10
}
\`\`\`

💡 **Cas d'usage du vecteur aléatoire:**
- Tester les performances de recherche sans préparer de vecteur
- Déboguer les index vectoriels
- Vérifier la répartition des données dans l'espace vectoriel
- Générer des exemples de requêtes
`,

          functions: `## 📐 Fonctions pgvector

\`\`\`sql
-- Obtenir les dimensions d'un vecteur
SELECT vector_dims(embedding) FROM documents LIMIT 1;
-- ⚠️ Pas array_length() qui ne fonctionne PAS avec vector!

-- Norme L2 d'un vecteur
SELECT vector_norm(embedding) FROM documents;

-- Calculer la distance entre deux vecteurs
SELECT '[1,2,3]'::vector <=> '[4,5,6]'::vector as cosine_distance;
SELECT '[1,2,3]'::vector <-> '[4,5,6]'::vector as l2_distance;

-- Vérifier le type d'une colonne
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'documents' AND column_name = 'embedding';
\`\`\`
`,

          errors: `## ❌ Erreurs courantes et solutions

| Erreur | Cause | Solution |
|--------|-------|----------|
| \`expected X dimensions, not Y\` | Vecteur de mauvaise taille | Utilisez un modèle d'embedding correspondant aux dimensions de la colonne |
| \`array_length(vector, integer) does not exist\` | Mauvaise fonction | Utilisez \`vector_dims(colonne)\` au lieu de \`array_length()\` |
| \`array_to_vector() does not exist\` | Fonction inexistante | Cast direct: \`'[...]'::vector\` |
| \`syntax error at or near ";"\` | Mauvaise syntaxe vecteur | Format correct: \`'[0.1,0.2,0.3]'::vector\` (chaîne avec crochets) |
| \`invalid input syntax for type vector\` | Format invalide | Vérifiez les crochets et virgules: \`'[0.1, 0.2]'::vector\` |

### Modèles d'embedding standards:
| Dimensions | Modèle | Provider |
|------------|--------|----------|
| 1536 | text-embedding-ada-002 | OpenAI |
| 3072 | text-embedding-3-large | OpenAI |
| 1024 | text-embedding-3-small | OpenAI |
| 768 | all-mpnet-base-v2 | HuggingFace |
| 384 | all-MiniLM-L6-v2 | Sentence Transformers |
`
        };

        if (args.topic === 'all') {
          output += topics.create + '\n';
          output += topics.insert + '\n';
          output += topics.search + '\n';
          output += topics.functions + '\n';
          output += topics.errors + '\n';
        } else {
          output += topics[args.topic];
        }

        output += `\n---\n💡 **Conseil LLM:** Utilisez toujours \`pgvector_insert_vector\` et \`pgvector_search\` au lieu d'écrire du SQL brut!\n`;

        return output;
      },
    });
  }
}
