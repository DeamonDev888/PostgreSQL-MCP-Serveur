import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { Pool } from 'pg';
import Logger from '../utils/logger.js';

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
   * Enregistre tous les outils pg_vector sur le serveur MCP
   */
  registerTools(): void {
    this.checkExtension();
    this.createVectorColumn();
    this.insertVector();
    this.vectorSearch();
    this.createVectorIndex();
    this.deleteVectors();
    this.vectorStats();
    this.listVectorTables();
    this.batchInsertVectors();
    this.updateVector();

    Logger.info('✅ Outils pg_vector enregistrés (10 outils)');
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

          return `❌ Erreur: ${error.message}`;
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
          return `❌ Erreur: ${error.message}`;
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
      description: 'Insère un vecteur dans une table',
      parameters: z.object({
        tableName: z.string().describe('Nom de la table'),
        vectorColumn: z.string().optional().default('embedding').describe('Nom de la colonne vectorielle'),
        vector: z.array(z.number()).describe('Tableau de nombres représentant le vecteur'),
        schema: z.string().optional().default('public').describe('Schéma de la table'),
        additionalValues: z.string().optional().describe('Valeurs supplémentaires (ex: content = \'mon texte\', metadata = \'{"key": "value"}\'::jsonb)'),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();

          const vectorString = `[${args.vector.join(',')}]`;
          const fullTableName = `"${args.schema}"."${args.tableName}"`;

          let query = `INSERT INTO ${fullTableName} (${args.vectorColumn}`;
          let values = `VALUES ('${vectorString}'::vector`;

          if (args.additionalValues) {
            query += `, ${args.additionalValues.split('=')[0].trim()}`;
            values += `, ${args.additionalValues.split('=').slice(1).join('=').trim()}`;
          }

          query += `) ${values})`;

          await client.query(query);
          await client.release();

          Logger.info(`✅ Vecteur inséré dans ${args.tableName}`);
          return `✅ Vecteur inséré dans ${args.schema}.${args.tableName}\n` +
                 `   Dimensions: ${args.vector.length}`;
        } catch (error: any) {
          Logger.error('❌ [pgvector_insert_vector]', error.message);
          return `❌ Erreur: ${error.message}`;
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
        queryVector: z.array(z.number()).describe('Vecteur de requête'),
        schema: z.string().optional().default('public').describe('Schéma de la table'),
        topK: z.number().optional().default(5).describe('Nombre de résultats à retourner'),
        distanceMetric: z.enum(['<=>', '<->', '<#>']).optional().default('<=>').describe('Métrique de distance: <=> (cosine), <-> (L2), <#> (inner product)'),
        selectColumns: z.string().optional().default('*').describe('Colonnes à sélectionner (ex: id, content, metadata)'),
        whereClause: z.string().optional().describe('Clause WHERE additionnelle (ex: category = \'docs\')'),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();

          const vectorString = `[${args.queryVector.join(',')}]`;
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
          return `❌ Erreur: ${error.message}`;
        }
      },
    });
  }

  // ========================================================================
  // 5. Créer un index vectoriel (HNSW ou IVFFlat)
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
          return `❌ Erreur: ${error.message}`;
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
          return `❌ Erreur: ${error.message}`;
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
          return `❌ Erreur: ${error.message}`;
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
          return `❌ Erreur: ${error.message}`;
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
          vector: z.array(z.number()),
          id: z.number().optional(),
          data: z.any().optional(),
        })).describe('Tableau de vecteurs avec leurs données associées'),
        schema: z.string().optional().default('public').describe('Schéma de la table'),
        additionalColumns: z.string().optional().describe('Colonnes supplémentaires à insérer (séparées par virgule)'),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();

          const fullTableName = `"${args.schema}"."${args.tableName}"`;

          // Construire la requête d'insertion
          let query = `INSERT INTO ${fullTableName} (${args.vectorColumn}`;
          let valuesPlaceholders: string[] = [];
          let allValues: any[] = [];

          if (args.additionalColumns) {
            const columns = args.additionalColumns.split(',').map((c: string) => c.trim());
            columns.forEach((col: string) => {
              query += `, ${col}`;
            });
          }
          query += ') VALUES ';

          args.vectors.forEach((item, index) => {
            const baseIndex = index * (args.additionalColumns ? args.additionalColumns.split(',').length + 1 : 1);
            let placeholders = `($${baseIndex + 1}::vector`;

            if (args.additionalColumns) {
              const columns = args.additionalColumns.split(',').length;
              for (let i = 1; i <= columns; i++) {
                placeholders += `, $${baseIndex + 1 + i}`;
              }
            }
            placeholders += ')';

            valuesPlaceholders.push(placeholders);
            allValues.push(`[${item.vector.join(',')}]`);

            // Ajouter les valeurs additionnelles
            if (args.additionalColumns && item.data) {
              const columns = args.additionalColumns.split(',').map((c: string) => c.trim());
              columns.forEach((col: string) => {
                const val = (item.data as any)[col];
                allValues.push(val !== undefined ? val : null);
              });
            }
          });

          query += valuesPlaceholders.join(', ');
          query += ' RETURNING *';

          const startTime = Date.now();
          const result = await client.query(query, allValues);
          const duration = Date.now() - startTime;

          await client.release();

          Logger.info(`✅ ${result.rows.length} vecteurs insérés dans ${args.tableName}`);
          return `✅ Insertion en lot réussie:\n` +
                 `   Table: ${args.schema}.${args.tableName}\n` +
                 `   Vecteurs insérés: ${result.rows.length}\n` +
                 `   Durée: ${duration}ms\n` +
                 `   Moyenne: ${(duration / result.rows.length).toFixed(2)}ms/vecteur`;
        } catch (error: any) {
          Logger.error('❌ [pgvector_batch_insert]', error.message);
          return `❌ Erreur: ${error.message}`;
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

          const query = `
            UPDATE ${fullTableName}
            SET ${args.vectorColumn} = '${vectorString}'::vector
            WHERE ${args.whereClause}
            RETURNING *
          `;

          const result = await client.query(query);
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
          return `❌ Erreur: ${error.message}`;
        }
      },
    });
  }
}
