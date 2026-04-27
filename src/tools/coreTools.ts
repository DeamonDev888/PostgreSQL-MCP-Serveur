#!/usr/bin/env node

import { FastMCP } from "fastmcp";
import { z } from "zod";
import { Pool } from "pg";
import Logger from "../utils/logger.js";
import { IntelligentSearchService } from "../services/intelligentSearchService.js";
import { embeddingService } from "../services/embeddingService.js";
import { DBOptimizer } from "../utils/dbOptimizer.js";
import { validateIdentifier, validateTopK } from "../utils/sqlValidator.js";

/**
 * Outils MCP Core - Refactorisation pour cohérence et simplicité
 *
 * 8 outils IMPLICITES et COHÉRENTS au lieu de 38 dispersés
 */
export class CoreTools {
  private pool: Pool;
  private server: FastMCP;
  private searchService: IntelligentSearchService;
  private optimizer: DBOptimizer;

  constructor(pool: Pool, server: FastMCP) {
    this.pool = pool;
    this.server = server;
    this.searchService = new IntelligentSearchService(pool);
    this.optimizer = new DBOptimizer(pool);
  }

  registerTools(): void {
    this.diagnose();
    this.explore();
    this.query();
    this.search();
    this.insert();
    this.manageVectors();
    this.optimize();
    this.vectorize_row();
    this.help();

    Logger.info("✅ Outils Core enregistrés (8 outils cohérents)");
  }

  // ============================================================================
  // 1. DIAGNOSE - Diagnostic Complet
  // ============================================================================
  private diagnose(): void {
    this.server.addTool({
      name: "diagnose",
      description:
        "🔍 Diagnostic complet de la base de données avec solutions automatiques",
      parameters: z.object({
        type: z
          .enum(["connection", "performance", "all"])
          .default("all")
          .describe("Type de diagnostic"),
        deep: z
          .boolean()
          .default(false)
          .describe("Diagnostic approfondi avec suggestions"),
      }),
      execute: async (args) => {
        const client = await this.pool.connect();
        try {
          // 1. Diagnostic de connexion
          if (args.type === "connection" || args.type === "all") {
            const connResult = await client.query(
              "SELECT version() as version, current_database() as database, current_user as user",
            );

            let output = `🔍 **Diagnostic de Connexion**\n\n`;
            output += `✅ **Statut**: Connecté\n`;
            output += `📊 Base: ${connResult.rows[0].database}\n`;
            output += `👤 Utilisateur: ${connResult.rows[0].user}\n`;
            output += `📋 Version: ${connResult.rows[0].version.split(" ")[0]} ${connResult.rows[0].version.split(" ")[1]}\n\n`;

            if (args.type === "connection") {
              return output;
            }
          }

          // 2. Diagnostic de performance
          if (args.type === "performance" || args.type === "all") {
            const cacheStats = await this.optimizer.getCacheHitRatios();
            const heapRatio = (cacheStats.heap_ratio || 0) * 100;
            const idxRatio = (cacheStats.idx_ratio || 0) * 100;

            let perfOutput = `\n📊 **Diagnostic de Performance**\n\n`;
            perfOutput += `🎯 **Cache Hit Ratio**:\n`;
            perfOutput += `  • Tables: ${heapRatio.toFixed(2)}%\n`;
            perfOutput += `  • Index: ${idxRatio.toFixed(2)}%\n\n`;

            // Analyse automatique
            if (heapRatio < 95 || idxRatio < 95) {
              perfOutput += `⚠️ **Problèmes détectés**:\n`;
              if (heapRatio < 95)
                perfOutput += `  • Cache tables faible (${heapRatio.toFixed(2)}%)\n`;
              if (idxRatio < 95)
                perfOutput += `  • Cache index faible (${idxRatio.toFixed(2)}%)\n`;
              perfOutput += `\n💡 **Actions recommandées**:\n`;
              perfOutput += `  1. Augmentez shared_buffers dans postgresql.conf\n`;
              perfOutput += `  2. Vérifiez effective_cache_size\n`;
              perfOutput += `  3. Exécutez VACUUM ANALYZE sur les tables actives\n`;
            } else {
              perfOutput += `✅ **Performance optimale** - Aucune action nécessaire\n`;
            }

            // Requêtes lentes
            try {
              const slowQueries = await this.optimizer.getSlowQueries(5);
              if (slowQueries.length > 0) {
                perfOutput += `\n🐌 **Requêtes lentes détectées** (${slowQueries.length}):\n`;
                slowQueries.slice(0, 3).forEach((q, i) => {
                  perfOutput += `  ${i + 1}. ${q.duration.toFixed(2)}ms - ${q.query.substring(0, 80)}...\n`;
                });
              }
            } catch {
              // pg_stat_statements non activé
            }

            return perfOutput;
          }

          return "Diagnostic terminé";
        } catch (error: any) {
          Logger.error("❌ [diagnose]", error.message);
          return `❌ Erreur: ${error.message}`;
        } finally {
          client.release();
        }
      },
    });
  }

  // ============================================================================
  // 2. EXPLORE - Exploration de la Base
  // ============================================================================
  private explore(): void {
    this.server.addTool({
      name: "explore",
      description:
        "🗺️ Explore et liste les bases, tables, schémas et structures",
      parameters: z.object({
        type: z
          .enum(["databases", "tables", "schema", "structure"])
          .default("tables")
          .describe("Type d'exploration"),
        target: z.string().optional().describe("Table ou schéma spécifique"),
        includeSize: z.boolean().default(false).describe("Inclure les tailles"),
      }),
      execute: async (args) => {
        const client = await this.pool.connect();
        try {
          switch (args.type) {
            case "databases": {
              const result = await client.query(`
                SELECT datname as database_name, datistemplate as is_template
                FROM pg_database
                WHERE datistemplate = false
                ORDER BY datname
              `);

              const databases = result.rows
                .map(
                  (row: any, index: number) =>
                    `${index + 1}. 📂 ${row.database_name}`,
                )
                .join("\n");

              return `📊 **Bases de données** (${result.rows.length}):\n\n${databases}`;
            }

            case "tables": {
              const schema = args.target || "public";
              const result = await client.query(
                `
                SELECT table_name, table_type
                FROM information_schema.tables
                WHERE table_schema = $1
                ORDER BY table_name
              `,
                [schema],
              );

              const tables = result.rows
                .map((row: any, index: number) => {
                  const type = row.table_type === "BASE TABLE" ? "📋" : "🔗";
                  return `${index + 1}. ${type} ${row.table_name}`;
                })
                .join("\n");

              return `📋 **Tables du schéma '${schema}'** (${result.rows.length}):\n\n${tables}`;
            }

            case "schema": {
              const tableName = args.target;
              if (!tableName) {
                return "❌ Veuillez spécifier une table avec target: table_name";
              }

              const result = await client.query(
                `
                SELECT column_name, data_type, character_maximum_length, is_nullable
                FROM information_schema.columns
                WHERE table_name = $1
                ORDER BY ordinal_position
              `,
                [tableName],
              );

              const columns = result.rows
                .map((col: any) => {
                  const length = col.character_maximum_length
                    ? `(${col.character_maximum_length})`
                    : "";
                  const nullable =
                    col.is_nullable === "YES" ? "NULL" : "NOT NULL";
                  return `  • ${col.column_name}: ${col.data_type}${length} ${nullable}`;
                })
                .join("\n");

              return `📋 **Structure de '${tableName}'** (${result.rows.length} colonnes):\n\n${columns}`;
            }

            case "structure": {
              // Vue d'ensemble complète
              const dbResult = await client.query(
                "SELECT current_database() as db",
              );
              const tablesResult = await client.query(`
                SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'
              `);

              return (
                `🗺️ **Structure de la Base**\n\n` +
                `📊 Base: ${dbResult.rows[0].db}\n` +
                `📋 Tables: ${tablesResult.rows[0].count}\n` +
                `💡 Utilisez explore avec type: 'tables' pour lister`
              );
            }

            default:
              return "❌ Type d'exploration invalide";
          }
        } catch (error: any) {
          Logger.error("❌ [explore]", error.message);
          return `❌ Erreur: ${error.message}`;
        } finally {
          client.release();
        }
      },
    });
  }

  // ============================================================================
  // 3. MCP_PG_VECTOR - Exécution SQL avec Guides LLM
  // ============================================================================
  private query(): void {
    this.server.addTool({
      name: "MCP_PG_VECTOR",
      description: `⚡ EXÉCUTION SQL DIRECTE (PostgreSQL + Vector)

🔒 **SÉCURITÉ:**
- Par défaut: readonly=true (SELECT seul)
- Pour INSERT/UPDATE: readonly=false OBLIGATOIRE
- "query" est l'ancien nom, utilisez MAINTENANT "MCP_PG_VECTOR"

📋 **EXEMPLES:**
MCP_PG_VECTOR({ sql: "SELECT * FROM users", readonly: true })
MCP_PG_VECTOR({ sql: "INSERT INTO logs VALUES ('test')", readonly: false })

💡 **POUR L'AGENT:** C'est VOTRE outil principal pour interagir avec la base.`,
      parameters: z.object({
        sql: z.string().describe("Requête SQL à exécuter"),
        validateOnly: z
          .boolean()
          .default(false)
          .describe("Valider sans exécuter"),
        readonly: z
          .boolean()
          .default(true)
          .describe("Mode lecture seule. FALSE = ÉCRITURE AUTORISÉE"),
        limit: z.number().default(100).describe("Limite de résultats"),
      }),
      execute: async (args) => {
        try {
          const queryTrimmed = args.sql.trim();
          const queryUpper = queryTrimmed.toUpperCase();
          const queryType = queryTrimmed.split(/\s+/)[0].toUpperCase();

          // Détection du type de requête pour guide LLM
          const isMutationQuery =
            /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b/.test(
              queryUpper,
            );

          // Validation automatique en mode readonly
          if (args.readonly && isMutationQuery) {
            return `❌ **Requête bloquée en mode lecture seule**

⚠️ Vous essayez d'exécuter une requête ${queryType} en mode readonly=true

🔧 **CORRECTION REQUISE:**
Réessayez avec: MCP_PG_VECTOR({ sql: "...", readonly: false })

💡 **Exemple pour ${queryType}:**
\`\`\`
MCP_PG_VECTOR({
  sql: "${queryType === "INSERT" ? "INSERT INTO table (col) VALUES (val)" : queryType === "UPDATE" ? "UPDATE table SET col = val WHERE id = X" : "DELETE FROM table WHERE id = X"}",
  readonly: false
})
\`\`\``;
          }

          // Vérifier que les requêtes SELECT commencent correctement
          if (args.readonly) {
            const safeKeywords = [
              "SELECT",
              "WITH",
              "SHOW",
              "DESCRIBE",
              "EXPLAIN",
              "VALUES",
            ];
            if (!safeKeywords.includes(queryType)) {
              return `❌ **Requête non reconnue en mode lecture**

⚠️ Le début de requête "${queryType}" n'est pas autorisé en readonly

💡 **Actions possibles:**
1. Pour une lecture: Utilisez SELECT, WITH, ou EXPLAIN
2. Pour une modification: Ajoutez readonly: false`;
            }
          }

          const client = await this.pool.connect();

          try {
            // Limite automatique pour SELECT
            let finalSql = queryTrimmed;
            if (
              !queryUpper.includes("LIMIT") &&
              (queryUpper.startsWith("SELECT") || queryUpper.startsWith("WITH"))
            ) {
              if (
                queryUpper.startsWith("SELECT") &&
                !queryUpper.includes("(")
              ) {
                finalSql = `${finalSql} LIMIT ${args.limit}`;
              } else {
                finalSql = `SELECT * FROM (${args.sql}) AS limited_query LIMIT ${args.limit}`;
              }
            }

            const startTime = Date.now();
            const result = await client.query(finalSql);
            const duration = Date.now() - startTime;

            // === OUTPUT ADAPTÉ AU TYPE DE REQUÊTE ===

            // Pour les mutations (INSERT, UPDATE, DELETE)
            if (isMutationQuery) {
              // Si RETURNING utilisé, on retourne le JSON brut comme pour SELECT
              if (result.rows && result.rows.length > 0) {
                return JSON.stringify(result.rows);
              }

              let output = `✅ **${queryType} exécuté avec succès**\n\n`;
              output += `⏱️ Durée: ${duration}ms\n`;
              output += `📊 Lignes affectées: ${result.rowCount || 0}\n`;

              output += `\n💡 **Prochaine action suggérée:**\n`;
              if (queryType === "INSERT") {
                output += `Vérifiez avec: SELECT * FROM ${this.extractTableName(queryTrimmed)} ORDER BY id DESC LIMIT 1`;
              } else if (queryType === "UPDATE" || queryType === "DELETE") {
                output += `Confirmez le changement avec une requête SELECT`;
              }

              return output;
            }

            // Pour les SELECT
            // 🛡️ MODIFICATION: Retourner JSON brut pour compatibilité agentic et éviter le bug des pipes '|'
            return JSON.stringify(result.rows);
          } finally {
            await client.release();
          }
        } catch (error: any) {
          Logger.error("❌ [query]", error.message);

          // Messages d'erreur contextuels pour LLM
          const errorMsg = error.message.toLowerCase();
          let guidance = "";

          if (
            errorMsg.includes("relation") &&
            errorMsg.includes("does not exist")
          ) {
            const tableName =
              error.message.match(/relation "([^"]+)"/)?.[1] || "unknown";
            guidance = `\n\n💡 **Guide LLM:** La table "${tableName}" n'existe pas.\n`;
            guidance += `Utilisez explore({ type: 'tables' }) pour voir les tables disponibles.`;
          } else if (
            errorMsg.includes("column") &&
            errorMsg.includes("does not exist")
          ) {
            const colName =
              error.message.match(/column "([^"]+)"/)?.[1] || "unknown";
            guidance = `\n\n💡 **Guide LLM:** La colonne "${colName}" n'existe pas.\n`;
            guidance += `Utilisez explore({ type: 'schema', target: 'table_name' }) pour voir les colonnes.`;
          } else if (errorMsg.includes("syntax error")) {
            guidance = `\n\n💡 **Guide LLM:** Erreur de syntaxe SQL. Vérifiez:\n`;
            guidance += `- Les guillemets (simples pour valeurs, doubles pour identifiants)\n`;
            guidance += `- Les virgules et parenthèses\n`;
            guidance += `- Les mots-clés SQL`;
          } else if (errorMsg.includes("violates foreign key")) {
            guidance = `\n\n💡 **Guide LLM:** Contrainte de clé étrangère violée.\n`;
            guidance += `Vérifiez que l'ID référencé existe dans la table parent.`;
          }

          return `❌ **Erreur SQL:** ${error.message}${guidance}`;
        }
      },
    });
  }

  /**
   * Extrait le nom de table d'une requête INSERT/UPDATE/DELETE
   */
  private extractTableName(sql: string): string {
    const insertMatch = sql.match(/INSERT\s+INTO\s+(\w+)/i);
    if (insertMatch) return insertMatch[1];

    const updateMatch = sql.match(/UPDATE\s+(\w+)/i);
    if (updateMatch) return updateMatch[1];

    const deleteMatch = sql.match(/DELETE\s+FROM\s+(\w+)/i);
    if (deleteMatch) return deleteMatch[1];

    return "table_name";
  }

  // ============================================================================
  // 4. SEARCH - Recherche Intelligente
  // ============================================================================
  private search(): void {
    this.server.addTool({
      name: "search",
      description:
        "🔍 Recherche intelligente avec détection automatique du mode optimal",
      parameters: z.object({
        query: z.string().describe("Requête de recherche"),
        table: z.string().default("documents").describe("Table à interroger"),
        mode: z
          .enum(["auto", "text", "vector", "hybrid"])
          .default("auto")
          .describe("Mode de recherche (auto = détecte automatiquement)"),
        topK: z.number().default(10).max(1000).describe("Nombre de résultats"),
        embed: z
          .boolean()
          .default(true)
          .describe("Générer un embedding si nécessaire"),
        contentColumn: z
          .string()
          .default("content")
          .describe("Colonne contenant le texte (pour mode hybrid/text)"),
      }),
      execute: async (args) => {
        try {
          const result = await this.searchService.search(args.query, {
            tableName: args.table,
            mode: args.mode,
            topK: args.topK,
            enableCache: args.embed,
            contentColumn: args.contentColumn,
          });

          let output = `🔍 **Recherche Intelligente**\n\n`;
          output += `📝 Query: "${args.query}"\n`;
          output += `🎯 Mode: ${result.metadata.actualMode} (demandé: ${args.mode})\n`;
          output += `⏱️ Temps: ${result.metadata.executionTime}ms\n`;
          output += `📊 Résultats: ${result.results.length}\n\n`;

          if (result.results.length > 0) {
            result.results.forEach((row: any, index: number) => {
              const score = row.similarity
                ? (row.similarity * 100).toFixed(1)
                : "N/A";
              output += `**${index + 1}.** Score: ${score}%\n`;

              const content =
                row.content || row.title || JSON.stringify(row, null, 2);
              if (content && typeof content === "string") {
                const displayContent =
                  content.length > 150
                    ? content.substring(0, 150) + "..."
                    : content;
                output += `   ${displayContent}\n\n`;
              }
            });
          } else {
            output += `❌ Aucun résultat trouvé\n\n`;
            output += `💡 **Suggestions:**\n`;
            output += `• Vérifiez l'orthographe\n`;
            output += `• Utilisez des mots-clés plus généraux\n`;
            output += `• Essayez mode: 'text' pour une recherche simple\n`;
          }

          return output;
        } catch (error: any) {
          Logger.error("❌ [search]", error.message);
          return `❌ Erreur: ${error.message}`;
        }
      },
    });
  }

  // ============================================================================
  // 5. INSERT - Insertion Simplifiée
  // ============================================================================
  private insert(): void {
    this.server.addTool({
      name: "insert",
      description:
        "📥 Insère des données avec ou sans vecteur généré automatiquement",
      parameters: z.object({
        table: z.string().describe("Nom de la table"),
        data: z.record(z.any()).describe("Données à insérer (objet JSON)"),
        generateEmbedding: z
          .boolean()
          .default(false)
          .describe("Générer un embedding automatiquement (Qwen 8B)"),
        dimensions: z
          .number()
          .default(4096)
          .describe("Dimensions du vecteur (4096 pour Qwen)"),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();

          // Construire les colonnes et valeurs
          const columns: string[] = [];
          const values: any[] = [];
          let paramIndex = 1;

          // Ajouter les données
          for (const [key, value] of Object.entries(args.data)) {
            columns.push(key);
            values.push(value);
          }

          // Générer l'embedding si demandé
          if (args.generateEmbedding) {
            const textParts: string[] = [];
            if (args.data.llm_interpretation)
              textParts.push(args.data.llm_interpretation);
            if (args.data.study_name)
              textParts.push(`Study: ${args.data.study_name}`);
            if (args.data.symbol) textParts.push(`Symbol: ${args.data.symbol}`);
            if (args.data.technical_data)
              textParts.push(
                `Technical: ${JSON.stringify(args.data.technical_data)}`,
              );

            const embeddingText =
              textParts.join(" | ") || JSON.stringify(args.data);
            Logger.info(
              `🔄 Génération embedding pour: "${embeddingText.substring(0, 50)}..."`,
            );

            const embedding = await embeddingService.generateEmbedding(
              embeddingText,
              {
                dimensions: args.dimensions,
              },
            );

            columns.push("embedding");
            values.push(`[${embedding.join(",")}]`);
          }

          // Construire la requête
          const placeholders = columns.map(() => `$${paramIndex++}`).join(", ");
          const query = `INSERT INTO ${args.table} (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`;

          const result = await client.query(query, values);
          await client.release();

          return (
            `✅ **Insertion réussie**\n\n` +
            `📋 Table: ${args.table}\n` +
            `📊 Lignes: ${result.rows.length}\n` +
            `🔑 ID: ${result.rows[0].id || "N/A"}\n` +
            `${args.generateEmbedding ? "🧠 Embedding généré: " + args.dimensions + "D\n" : ""}`
          );
        } catch (error: any) {
          Logger.error("❌ [insert]", error.message);
          return `❌ Erreur: ${error.message}`;
        }
      },
    });
  }

  // ============================================================================
  // 6. MANAGE_VECTORS - Gestion Vectorielle
  // ============================================================================
  private manageVectors(): void {
    this.server.addTool({
      name: "manage_vectors",
      description:
        "🧬 Gestion complète des vecteurs : création, index, statistiques, optimisation",
      parameters: z.object({
        action: z
          .enum(["create", "index", "stats", "optimize", "list"])
          .describe("Action à effectuer"),
        table: z.string().describe("Nom de la table"),
        column: z.string().default("embedding").describe("Colonne vectorielle"),
        dimensions: z
          .number()
          .default(4096)
          .describe("Dimensions du vecteur (4096 pour Qwen)"),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();

          switch (args.action) {
            case "create": {
              const query = `
                CREATE TABLE IF NOT EXISTS ${args.table} (
                  id SERIAL PRIMARY KEY,
                  ${args.column} vector(${args.dimensions}),
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
              `;
              await client.query(query);
              await client.release();
              return `✅ **Table vectorielle créée**\n\n📋 Table: ${args.table}\n🧬 Colonne: ${args.column} (${args.dimensions}D)`;
            }

            case "index": {
              const indexName = `${args.table}_${args.column}_idx`;
              const query = `CREATE INDEX IF NOT EXISTS ${indexName} ON ${args.table} USING ivfflat (${args.column} vector_cosine_ops) WITH (lists = 100);`;
              await client.query(query);
              await client.release();
              return `✅ **Index vectoriel créé**\n\n📋 Table: ${args.table}\n🧬 Index: ${indexName}\n🎯 Type: IVFFlat (cosine)`;
            }

            case "stats": {
              const result = await client.query(`
                SELECT COUNT(*) as total_rows,
                       AVG(array_length(${args.column}, 1)) as avg_dimensions
                FROM ${args.table}
                WHERE ${args.column} IS NOT NULL
              `);
              await client.release();
              return `📊 **Statistiques Vectorielles**\n\n📋 Table: ${args.table}\n📈 Lignes: ${result.rows[0].total_rows}\n🧬 Dimensions: ${result.rows[0].avg_dimensions || args.dimensions}`;
            }

            case "optimize": {
              await client.query(`VACUUM ANALYZE ${args.table}`);
              await client.release();
              return `✅ **Optimisation terminée**\n\n📋 Table: ${args.table}\n🧹 VACUUM ANALYZE exécuté`;
            }

            case "list": {
              const result = await client.query(`
                SELECT table_name, column_name, data_type
                FROM information_schema.columns
                WHERE data_type = 'vector'
                ORDER BY table_name
              `);
              await client.release();

              if (result.rows.length === 0) {
                return "ℹ️ **Aucune table vectorielle trouvée**";
              }

              const tables = result.rows
                .map(
                  (row: any, index: number) =>
                    `${index + 1}. 📋 ${row.table_name}.${row.column_name} (${row.data_type})`,
                )
                .join("\n");

              return `🧬 **Tables Vectorielles** (${result.rows.length}):\n\n${tables}`;
            }

            default:
              return "❌ Action invalide";
          }
        } catch (error: any) {
          Logger.error("❌ [manage_vectors]", error.message);
          return `❌ Erreur: ${error.message}`;
        }
      },
    });
  }

  // ============================================================================
  // 7. OPTIMIZE - Optimisation
  // ============================================================================
  private optimize(): void {
    this.server.addTool({
      name: "optimize",
      description:
        "⚡ Optimise la base de données (index, requêtes, performances)",
      parameters: z.object({
        target: z
          .enum(["indexes", "queries", "tables", "all"])
          .default("all")
          .describe("Cible d'optimisation"),
      }),
      execute: async (args) => {
        try {
          let output = `⚡ **Optimisation de la Base**\n\n`;

          if (args.target === "indexes" || args.target === "all") {
            const indexes = await this.optimizer.analyzeIndexUsage();
            const unused = indexes.filter((idx) => idx.usage === 0);

            if (unused.length > 0) {
              output += `🗑️ **Index non utilisés** (${unused.length}):\n`;
              unused.slice(0, 5).forEach((idx) => {
                output += `  • ${idx.indexname} sur ${idx.tablename}\n`;
              });
              output += `\n💡 Supprimez ces index pour améliorer les performances d'écriture\n\n`;
            } else {
              output += `✅ **Index**: Tous bien utilisés\n\n`;
            }
          }

          if (args.target === "queries" || args.target === "all") {
            try {
              const slowQueries = await this.optimizer.getSlowQueries(5);
              if (slowQueries.length > 0) {
                output += `🐌 **Requêtes lentes** (${slowQueries.length}):\n`;
                slowQueries.forEach((q, i) => {
                  output += `  ${i + 1}. ${q.duration.toFixed(2)}ms\n`;
                });
                output += `\n💡 Analysez et optimisez ces requêtes\n\n`;
              }
            } catch {
              output += `ℹ️ **Requêtes lentes**: pg_stat_statements non activé\n\n`;
            }
          }

          if (args.target === "tables" || args.target === "all") {
            const stats = await this.optimizer.getTableStatistics();
            const needVacuum = stats.filter((s) => {
              const deadRatio =
                s.n_live_tup > 0
                  ? s.n_dead_tup / (s.n_live_tup + s.n_dead_tup)
                  : 0;
              return deadRatio > 0.1;
            });

            if (needVacuum.length > 0) {
              output += `🧹 **Tables nécessitant VACUUM** (${needVacuum.length}):\n`;
              needVacuum.slice(0, 3).forEach((t) => {
                const deadRatio =
                  t.n_live_tup > 0
                    ? (
                        (t.n_dead_tup / (t.n_live_tup + t.n_dead_tup)) *
                        100
                      ).toFixed(1)
                    : "0";
                output += `  • ${t.tablename}: ${deadRatio}% tuples morts\n`;
              });
              output += `\n💡 Exécutez VACUUM ANALYZE sur ces tables\n\n`;
            } else {
              output += `✅ **Tables**: Aucune action nécessaire\n\n`;
            }
          }

          return output;
        } catch (error: any) {
          Logger.error("❌ [optimize]", error.message);
          return `❌ Erreur: ${error.message}`;
        }
      },
    });
  }

  // ============================================================================
  // 8. VECTORIZE_ROW - Vectorisation à la demande
  // ============================================================================
  private vectorize_row(): void {
    this.server.addTool({
      name: "vectorize_row",
      description:
        "🧠 Génère et sauvegarde un embedding pour une ligne existante (Qwen 8B)",
      parameters: z.object({
        table: z.string().describe("Nom de la table"),
        id: z.string().describe("ID de la ligne (UUID ou Integer)"),
        text_columns: z
          .array(z.string())
          .describe("Colonnes à utiliser pour le texte source"),
        target_column: z
          .string()
          .default("embedding")
          .describe("Colonne cible pour le vecteur"),
      }),
      execute: async (args) => {
        try {
          const client = await this.pool.connect();
          try {
            // 1. Fetch content
            const cols = args.text_columns
              .map((c) => `COALESCE(${c}, '')`)
              .join(" || ' ' || ");
            const selectQuery = `SELECT ${cols} as combined_text FROM ${args.table} WHERE id = $1`;

            // Dynamic ID typing check (simple heuristic)
            const idVal = args.id;

            const res = await client.query(selectQuery, [idVal]);
            if (res.rows.length === 0) return "❌ ID introuvable";

            const text = res.rows[0].combined_text;
            if (!text || text.length < 5)
              return "⚠️ Texte trop court pour vectoriser";

            // 2. Generate
            const vector = await embeddingService.generateEmbedding(text, {
              dimensions: 4096,
            });

            // 3. Update
            const vectorStr = `[${vector.join(",")}]`;
            await client.query(
              `UPDATE ${args.table} SET ${args.target_column} = $1::vector WHERE id = $2`,
              [vectorStr, idVal],
            );

            return `✅ Vecteur ${vector.length} dims généré et sauvegardé pour ID ${args.id}`;
          } finally {
            client.release();
          }
        } catch (error: any) {
          Logger.error("❌ [vectorize_row]", error.message);
          return `❌ Erreur: ${error.message}`;
        }
      },
    });
  }

  // ============================================================================
  // 9. HELP - Aide Contextuelle
  // ============================================================================
  private help(): void {
    this.server.addTool({
      name: "help",
      description: "❓ Aide et documentation contextuelle",
      parameters: z.object({
        topic: z
          .string()
          .optional()
          .describe("Sujet spécifique (search, query, insert, etc.)"),
      }),
      execute: async (args) => {
        if (!args.topic) {
          return (
            `❓ **Aide - Outils MCP Core**\n\n` +
            `🤖 **8 outils simples et cohérents:**\n\n` +
            `1. 🔍 **diagnose** - Diagnostic complet (connexion, performance)\n` +
            `2. 🗺️ **explore** - Explorer bases, tables, schémas\n` +
            `3. ⚡ **query** - Exécuter des requêtes SQL\n` +
            `4. 🔍 **search** - Recherche intelligente (auto-détection)\n` +
            `5. 📥 **insert** - Insérer données (avec/sans embedding)\n` +
            `6. 🧬 **manage_vectors** - Gestion vecteurs (création, index)\n` +
            `7. ⚡ **optimize** - Optimiser index, requêtes, tables\n` +
            `8. ❓ **help** - Cette aide\n\n` +
            `💡 **Exemples:**\n` +
            `• help topic: "search" - Aide sur la recherche\n` +
            `• help topic: "insert" - Aide sur l'insertion\n`
          );
        }

        const topic = args.topic.toLowerCase();

        switch (topic) {
          case "search":
            return (
              `🔍 **Aide - Recherche Intelligente**\n\n` +
              `**Usage:**\n` +
              `{\n` +
              `  "tool": "search",\n` +
              `  "arguments": {\n` +
              `    "query": "votre requête",\n` +
              `    "table": "documents",\n` +
              `    "mode": "auto"  // auto, text, vector, hybrid\n` +
              `  }\n` +
              `}\n\n` +
              `**Modes:**\n` +
              `• **auto**: Détecte automatiquement le meilleur mode\n` +
              `• **text**: Recherche full-text PostgreSQL (rapide)\n` +
              `• **vector**: Recherche sémantique (précise)\n` +
              `• **hybrid**: Combinaison text + vecteur (optimal)\n\n` +
              `💡 **Conseil**: Utilisez toujours mode: "auto" pour de meilleurs résultats`
            );

          case "insert":
            return (
              `📥 **Aide - Insertion de Données**\n\n` +
              `**Usage simple:**\n` +
              `{\n` +
              `  "tool": "insert",\n` +
              `  "arguments": {\n` +
              `    "table": "ma_table",\n` +
              `    "data": { "nom": "valeur" }\n` +
              `  }\n` +
              `}\n\n` +
              `**Avec embedding automatique:**\n` +
              `{\n` +
              `  "tool": "insert",\n` +
              `  "arguments": {\n` +
              `    "table": "documents",\n` +
              `    "data": {\n` +
              `      "title": "Mon document",\n` +
              `      "content": "Contenu du document"\n` +
              `    },\n` +
              `    "generateEmbedding": true\n` +
              `  }\n` +
              `}`
            );

          case "query":
            return (
              `⚡ **Aide - Requêtes SQL**\n\n` +
              `**Usage (lecture seule):**\n` +
              `{\n` +
              `  "tool": "query",\n` +
              `  "arguments": {\n` +
              `    "sql": "SELECT * FROM users LIMIT 10"\n` +
              `  }\n` +
              `}\n\n` +
              `**Avec modifications:**\n` +
              `{\n` +
              `  "tool": "query",\n` +
              `  "arguments": {\n` +
              `    "sql": "INSERT INTO users (name) VALUES ('John')",\n` +
              `    "readonly": false\n` +
              `  }\n` +
              `}\n\n` +
              `⚠️ **Sécurité**: readonly=true bloque INSERT/UPDATE/DELETE`
            );

          case "diagnose":
            return (
              `🔍 **Aide - Diagnostic**\n\n` +
              `**Usage:**\n` +
              `{\n` +
              `  "tool": "diagnose",\n` +
              `  "arguments": {\n` +
              `    "type": "all"  // connection, performance, all\n` +
              `  }\n` +
              `}\n\n` +
              `**Inclut:**\n` +
              `• Statut de connexion\n` +
              `• Cache hit ratio\n` +
              `• Requêtes lentes\n` +
              `• Suggestions d'optimisation`
            );

          default:
            return (
              `❓ **Aide - ${args.topic}**\n\n` +
              `Utilisez "help" sans paramètre pour voir la liste des outils.\n` +
              `Ou demandez: help topic: "search", "insert", "query", etc.`
            );
        }
      },
    });
  }
}
