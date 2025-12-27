#!/usr/bin/env node

import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { Pool } from 'pg';
import config, { dbConfig } from './config.js';
import Logger from './utils/logger.js';
import { validateSQL } from './utils/sqlHelper.js';
import { DBOptimizer } from './utils/dbOptimizer.js';
import { PGVectorTools } from './tools/pgvector.js';

// IMPORTANT: Ne PAS utiliser console.log car cela corrupt le protocole MCP sur stdout !
// Rediriger console.log vers Logger.info
console.log = (...args: any[]) => {
  Logger.info('[STDOUT REDIRECT]', ...args);
};

// Initialisation du serveur MCP
const server = new FastMCP({
  name: 'postgresql-mcp-server',
  version: '1.0.0',
});

// Pool de connexions PostgreSQL
let pool: Pool | null = null;

// État global du serveur
const globalState = {
  isConnected: false,
  connectionInfo: null as any,
  lastError: null as string | null,
  connectionCount: 0,
};

// Fonction pour obtenir le pool de connexions
function getPool(): Pool {
  if (!pool) {
    pool = new Pool(config.database);

    // Gestionnaire d'événements pour le pool
    pool.on('connect', () => {
      Logger.info('🔗 Nouvelle connexion PostgreSQL établie');
      globalState.connectionCount++;
      updateGlobalState(true);
    });

    pool.on('error', (err) => {
      Logger.error('❌ Erreur du pool PostgreSQL:', err);
      updateGlobalState(false, err.message);
    });

    pool.on('remove', () => {
      globalState.connectionCount--;
      Logger.debug(`📤 Connexion retirée du pool. Total: ${globalState.connectionCount}`);
    });
  }
  return pool;
}

// Fonction pour mettre à jour l'état global
function updateGlobalState(connected: boolean, error?: string) {
  globalState.isConnected = connected;
  globalState.lastError = error || null;

  if (connected && pool) {
    globalState.connectionInfo = {
      host: config.database.connectionString?.split('@')[1]?.split('/')[0] || 'localhost',
      database: dbConfig.POSTGRES_DATABASE,
      activeConnections: globalState.connectionCount,
      maxConnections: config.database.max,
      sslEnabled: config.database.ssl !== false,
    };
  }
}

// ============================================================================
// ENREGISTREMENT DES MODULES D'OUTILS
// ============================================================================

// Enregistrer les outils pg_vector
const pgVectorTools = new PGVectorTools(getPool(), server);
pgVectorTools.registerTools();

// ============================================================================
// OUTILS MCP - EXPLORATION DE BASE DE DONNÉES
// ============================================================================

// 1. Statut de connexion PostgreSQL
server.addTool({
  name: 'postgres_status',
  description: 'Vérifie le statut de connexion à la base de données PostgreSQL',
  parameters: z.object({}),
  execute: async () => {
    try {
      const testPool = getPool();
      const client = await testPool.connect();

      // Test simple de connexion
      const result = await client.query('SELECT version() as version, current_database() as database, current_user as user');
      await client.release();

      const info = result.rows[0];

      return `✅ Connecté à PostgreSQL | Base: ${info.database} | Utilisateur: ${info.user} | Version: ${info.version.split(' ')[1]}`;
    } catch (error: any) {
      Logger.error('❌ [postgres_status]', error.message);
      updateGlobalState(false, error.message);
      return `❌ Erreur de connexion | ${error.message}`;
    }
  },
});

// 1.5. Diagnostic complet PostgreSQL
server.addTool({
  name: 'postgres_diagnose',
  description: "Diagnostic complet : vérifie Docker, PostgreSQL, base de données et fournit des solutions",
  parameters: z.object({
    checkDocker: z.boolean().optional().describe("Vérifier si Docker est en cours d'exécution").default(true),
    checkPg: z.boolean().optional().describe("Vérifier si PostgreSQL est accessible").default(true),
  }),
  execute: async (args) => {
    const diagnostics: string[] = [];
    let allGood = true;

    // 1. Vérification de Docker
    if (args.checkDocker) {
      diagnostics.push('🔍 **Diagnostic Docker :**');
      try {
        const dockerCheck = await import('child_process').then(({ execSync }) => {
          try {
            execSync('docker --version', { stdio: 'ignore' });
            return '✅ Docker est installé';
          } catch {
            return '❌ Docker n\'est pas installé ou pas dans le PATH';
          }
        });
        diagnostics.push(dockerCheck);

        // Vérifier si le conteneur PostgreSQL est en cours d'exécution
        try {
          const containerCheck = await import('child_process').then(({ execSync }) => {
            try {
              const output = execSync('docker ps --filter name=postgres --format "{{.Names}}"', { encoding: 'utf8' });
              if (output.trim()) {
                return `✅ Conteneur PostgreSQL détecté : ${output.trim()}`;
              } else {
                return '⚠️  Aucun conteneur PostgreSQL en cours d\'exécution';
              }
            } catch {
              return '⚠️  Impossible de vérifier les conteneurs Docker';
            }
          });
          diagnostics.push(containerCheck);
        } catch {
          // Ignore errors for container check
        }
      } catch {
        diagnostics.push('❌ Impossible de vérifier Docker');
      }
    }

    // 2. Vérification de PostgreSQL
    if (args.checkPg) {
      diagnostics.push('\n🔍 **Diagnostic PostgreSQL :**');
      diagnostics.push(`📍 Configuration :`);
      diagnostics.push(`   - Hôte : ${dbConfig.POSTGRES_HOST}:${dbConfig.POSTGRES_PORT}`);
      diagnostics.push(`   - Base : ${dbConfig.POSTGRES_DATABASE}`);
      diagnostics.push(`   - Utilisateur : ${dbConfig.POSTGRES_USER}`);

      // Test de connexion
      try {
        const testPool = getPool();
        const client = await testPool.connect();
        const result = await client.query('SELECT version() as version, current_database() as database');

        diagnostics.push('\n✅ **Connexion PostgreSQL : RÉUSSIE**');
        diagnostics.push(`   - Version : ${result.rows[0].version.split(' ')[0]} ${result.rows[0].version.split(' ')[1]}`);
        diagnostics.push(`   - Base active : ${result.rows[0].database}`);
        diagnostics.push(`   - Statut : Opérationnel`);

        await client.release();
        allGood = allGood && true;
      } catch (error: any) {
        diagnostics.push('\n❌ **Connexion PostgreSQL : ÉCHEC**');
        diagnostics.push(`   - Erreur : ${error.message}`);

        if (error.code === 'ECONNREFUSED') {
          diagnostics.push('\n🔧 **Solutions possibles :**');
          diagnostics.push('   1. Démarrer PostgreSQL :');
          diagnostics.push('      - Via Docker Desktop :');
          diagnostics.push('        • Lancez Docker Desktop manuellement');
          diagnostics.push('        • Attendez que l\'icône indique "Running"');
          diagnostics.push('        • Créez un conteneur PostgreSQL');
          diagnostics.push('      - Via service local : sudo systemctl start postgresql');
          diagnostics.push('   2. Vérifier la configuration :');
          diagnostics.push(`      - Hôte actuel : ${dbConfig.POSTGRES_HOST}:${dbConfig.POSTGRES_PORT}`);
          diagnostics.push('      - Modifier .env si nécessaire');
        } else if (error.code === '28P01') {
          diagnostics.push('\n🔧 **Solutions possibles :**');
          diagnostics.push('   - Vérifier le nom d\'utilisateur et le mot de passe dans .env');
          diagnostics.push('   - Créer l\'utilisateur si nécessaire');
        } else if (error.code === '3D000') {
          diagnostics.push('\n🔧 **Solutions possibles :**');
          diagnostics.push('   - Créer la base de données :');
          diagnostics.push(`      - CREATE DATABASE ${dbConfig.POSTGRES_DATABASE};`);
        }

        allGood = false;
      }
    }

    diagnostics.push('\n' + '='.repeat(50));
    if (allGood) {
      diagnostics.push('✅ **Diagnostic global : TOUT EST OK**');
    } else {
      diagnostics.push('⚠️  **Diagnostic global : PROBLÈMES DÉTECTÉS**');
      diagnostics.push('\n💡 **Actions recommandées :**');
      diagnostics.push('   1. Démarrez Docker Desktop manuellement');
      diagnostics.push('   2. Ou configurez PostgreSQL local');
      diagnostics.push('   3. Vérifiez votre configuration dans .env');
    }

    return diagnostics.join('\n');
  },
});

// 2. Lister les bases de données
server.addTool({
  name: 'list_databases',
  description: 'Liste toutes les bases de données accessibles',
  parameters: z.object({
    includeSize: z.boolean().optional().default(false).describe('Inclure la taille des bases de données'),
  }),
  execute: async (args) => {
    try {
      const pool = getPool();
      const client = await pool.connect();

      let query = `
        SELECT
          datname as database_name,
          datistemplate as is_template,
          datallowconn as allow_connection
        FROM pg_database
        WHERE datistemplate = false
        ORDER BY datname
      `;

      if (args.includeSize) {
        query = `
          SELECT
            d.datname as database_name,
            d.datistemplate as is_template,
            d.datallowconn as allow_connection,
            pg_size_pretty(pg_database_size(d.datname)) as size
          FROM pg_database d
          WHERE d.datistemplate = false
          ORDER BY d.datname
        `;
      }

      const result = await client.query(query);
      await client.release();

      const databases = result.rows.map((row: any, index: number) => {
        const status = row.allow_connection ? '✅' : '🔒';
        const size = args.includeSize ? ` (${row.size})` : '';
        return `${index + 1}. ${status} ${row.database_name}${size}`;
      }).join('\n');

      return `📊 **Bases de données (${result.rows.length}):**\n${databases}`;
    } catch (error: any) {
      Logger.error('❌ [list_databases]', error.message);
      return `❌ Erreur: ${error.message}`;
    }
  },
});

// 3. Lister les tables
server.addTool({
  name: 'list_tables',
  description: 'Liste toutes les tables d\'une base de données',
  parameters: z.object({
    schema: z.string().optional().default('public').describe('Schéma à explorer (défaut: public)'),
    includeSize: z.boolean().optional().default(false).describe('Inclure la taille des tables'),
  }),
  execute: async (args) => {
    try {
      const pool = getPool();
      const client = await pool.connect();

      let query = `
        SELECT
          table_name,
          table_type
        FROM information_schema.tables
        WHERE table_schema = $1
        ORDER BY table_name
      `;

      if (args.includeSize) {
        query = `
          SELECT
            t.table_name,
            t.table_type,
            pg_size_pretty(pg_total_relation_size(c.oid)) as size
          FROM information_schema.tables t
          JOIN pg_class c ON c.relname = t.table_name
          WHERE t.table_schema = $1
          ORDER BY t.table_name
        `;
      }

      const result = await client.query(query, [args.schema]);
      await client.release();

      const tables = result.rows.map((row: any, index: number) => {
        const type = row.table_type === 'BASE TABLE' ? '📋' : '🔗';
        const size = args.includeSize ? ` (${row.size})` : '';
        return `${index + 1}. ${type} ${row.table_name}${size}`;
      }).join('\n');

      return `📋 **Tables du schéma '${args.schema}' (${result.rows.length}):**\n${tables}`;
    } catch (error: any) {
      Logger.error('❌ [list_tables]', error.message);
      return `❌ Erreur: ${error.message}`;
    }
  },
});

// 4. Décrire une table
server.addTool({
  name: 'describe_table',
  description: 'Affiche la structure détaillée d\'une table',
  parameters: z.object({
    table: z.string().describe('Nom de la table'),
    schema: z.string().optional().default('public').describe('Schéma de la table (défaut: public)'),
  }),
  execute: async (args) => {
    try {
      const pool = getPool();
      const client = await pool.connect();

      // Informations sur les colonnes
      const columnsQuery = `
        SELECT
          column_name,
          data_type,
          character_maximum_length,
          is_nullable,
          column_default,
          ordinal_position
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `;

      const columnsResult = await client.query(columnsQuery, [args.schema, args.table]);

      await client.release();

      if (columnsResult.rows.length === 0) {
        return `❌ Table '${args.schema}.${args.table}' introuvable`;
      }

      // Formater les colonnes
      const columns = columnsResult.rows.map((col: any) => {
        const length = col.character_maximum_length ? `(${col.character_maximum_length})` : '';
        const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        const def = col.column_default ? ` DEFAULT ${col.column_default}` : '';
        return `  • ${col.column_name}: ${col.data_type}${length} ${nullable}${def}`;
      }).join('\n');

      let result = `📋 **Table: ${args.schema}.${args.table}**\n\n`;
      result += `**Colonnes (${columnsResult.rows.length}):**\n${columns}\n`;

      return result;
    } catch (error: any) {
      Logger.error('❌ [describe_table]', error.message);
      return `❌ Erreur: ${error.message}`;
    }
  },
});

// 5. Exécuter une requête SQL
server.addTool({
  name: 'execute_query',
  description: 'Exécute une requête SQL et retourne les résultats',
  parameters: z.object({
    query: z.string().describe('Requête SQL à exécuter'),
    readonly: z.boolean().optional().default(true).describe('Mode lecture seule (recommandé)'),
    limit: z.number().optional().default(100).describe('Nombre maximum de résultats'),
  }),
  execute: async (args) => {
    try {
      // Validation de base de sécurité
      const queryUpper = args.query.toUpperCase().trim();

      if (args.readonly) {
        const forbiddenKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE'];
        const hasForbidden = forbiddenKeywords.some(keyword => queryUpper.includes(keyword));

        if (hasForbidden) {
          return `❌ Requête non autorisée en mode lecture seule. Mots-clés interdits: ${forbiddenKeywords.join(', ')}`;
        }
      }

      // Valider la syntaxe SQL
      const validation = validateSQL(args.query);
      if (!validation.valid) {
        return `❌ Erreur de syntaxe SQL: ${validation.error}`;
      }

      const pool = getPool();
      const client = await pool.connect();

      try {
        // Ajouter une limite si pas présente et si c'est un SELECT
        let finalQuery = args.query;
        if (!queryUpper.includes('LIMIT') && queryUpper.startsWith('SELECT')) {
          finalQuery = `SELECT * FROM (${args.query}) AS limited_query LIMIT ${args.limit}`;
        }

        const startTime = Date.now();
        const result = await client.query(finalQuery);
        const duration = Date.now() - startTime;

        // Formatter les résultats
        let output = `✅ **Requête exécutée**\n`;
        output += `⏱️ Durée: ${duration}ms\n`;
        output += `📊 Résultats: ${result.rows.length} ligne(s)\n\n`;

        if (result.rows.length > 0) {
          // Entêtes
          const headers = Object.keys(result.rows[0]);
          output += `| ${headers.join(' | ')} |\n`;
          output += `|${headers.map(() => '---').join('|')}|\n`;

          // Données (limitées à 50 lignes pour l'affichage)
          const displayRows = result.rows.slice(0, 50);
          displayRows.forEach((row: any) => {
            const values = headers.map((h: string) => {
              const val = row[h];
              if (val === null) return 'NULL';
              if (typeof val === 'object') return JSON.stringify(val);
              return String(val);
            });
            output += `| ${values.join(' | ')} |\n`;
          });

          if (result.rows.length > 50) {
            output += `\n... et ${result.rows.length - 50} autres lignes`;
          }
        }

        return output;
      } finally {
        await client.release();
      }
    } catch (error: any) {
      Logger.error('❌ [execute_query]', error.message);
      return `❌ Erreur SQL: ${error.message}`;
    }
  },
});

// 6. Valider une requête SQL
server.addTool({
  name: 'validate_query',
  description: 'Valide la syntaxe d\'une requête SQL sans l\'exécuter',
  parameters: z.object({
    query: z.string().describe('Requête SQL à valider'),
  }),
  execute: async (args) => {
    try {
      const validation = validateSQL(args.query);

      if (validation.valid) {
        return `✅ **Requête valide**\n\n💡 Analyse:\n${validation.analysis}`;
      } else {
        return `❌ **Requête invalide**\n\n🔍 Erreur: ${validation.error}\n\n💡 Suggestion: ${validation.suggestion}`;
      }
    } catch (error: any) {
      Logger.error('❌ [validate_query]', error.message);
      return `❌ Erreur de validation: ${error.message}`;
    }
  },
});

// 7. Tester la connexion
server.addTool({
  name: 'test_connection',
  description: 'Teste la connexion à la base de données',
  parameters: z.object({}),
  execute: async () => {
    try {
      const startTime = Date.now();
      const pool = getPool();
      const client = await pool.connect();

      const result = await client.query({
        text: 'SELECT 1 as test, version() as version',
        name: 'test-connection'
      });

      await client.release();
      const duration = Date.now() - startTime;

      return `✅ **Connexion réussie**\n\n` +
             `⏱️ Latence: ${duration}ms\n` +
             `📊 Version: ${result.rows[0].version.split(' ')[1]}`;
    } catch (error: any) {
      Logger.error('❌ [test_connection]', error.message);
      return `❌ **Échec de connexion**\n\n🔍 Erreur: ${error.message}`;
    }
  },
});

// 8. Obtenir les informations de connexion
server.addTool({
  name: 'get_connection_info',
  description: 'Affiche les informations détaillées de la connexion actuelle',
  parameters: z.object({}),
  execute: async () => {
    try {
      if (!globalState.isConnected) {
        return '❌ Non connecté à la base de données';
      }

      const info = globalState.connectionInfo;

      return `🔗 **Informations de connexion**\n\n` +
             `📊 Hôte: ${info.host}\n` +
             `🗄️ Base: ${info.database}\n` +
             `👤 Utilisateur: ${dbConfig.POSTGRES_USER}\n` +
             `🔌 Connexions actives: ${info.activeConnections}/${info.maxConnections}\n` +
             `🔒 SSL: ${info.sslEnabled ? 'Activé' : 'Désactivé'}\n` +
             `⏱️ Timeout inactivité: ${dbConfig.POSTGRES_IDLE_TIMEOUT}ms`;
    } catch (error: any) {
      Logger.error('❌ [get_connection_info]', error.message);
      return `❌ Erreur: ${error.message}`;
    }
  },
});

// ============================================================================
// OUTILS MCP - OPTIMISATION ET PERFORMANCE
// ============================================================================

// Fonction helper pour obtenir l'optimiseur
function getOptimizer(): DBOptimizer {
  const pool = getPool();
  return new DBOptimizer(pool);
}

// 9. Analyser les requêtes lentes
server.addTool({
  name: 'analyze_slow_queries',
  description: 'Analyse les requêtes les plus lentes de la base de données',
  parameters: z.object({
    limit: z.number().optional().default(10).describe('Nombre de requêtes à analyser'),
  }),
  execute: async (args) => {
    try {
      const optimizer = getOptimizer();
      const slowQueries = await optimizer.getSlowQueries(args.limit);

      if (slowQueries.length === 0) {
        return '✅ Aucune requête lente détectée (pg_stat_statements doit être activé)';
      }

      let output = `🐌 **${slowQueries.length} requêtes lentes détectées**\n\n`;

      slowQueries.forEach((query, index) => {
        output += `**${index + 1}. Temps moyen: ${query.duration.toFixed(2)}ms**\n`;
        output += `📊 Appels: ${query.calls} | Total: ${query.total_time.toFixed(2)}ms\n`;
        output += `\`\`\`sql\n${query.query}\n\`\`\`\n\n`;
      });

      return output;
    } catch (error: any) {
      Logger.error('❌ [analyze_slow_queries]', error.message);

      // Message d'erreur amélioré pour pg_stat_statements
      if (error.message.includes('pg_stat_statements') ||
          (error.message.includes('relation') && error.message.includes('does not exist'))) {
        return `❌ **pg_stat_statements n'est pas activé**

Cette fonctionnalité nécessite l'extension pg_stat_statements.

📦 **Activation de pg_stat_statements:**

1. **Ajouter à postgresql.conf:**
\`\`\`
shared_preload_libraries = 'pg_stat_statements'
\`\`\`

2. **Redémarrer PostgreSQL:**
\`\`\`bash
sudo systemctl restart postgresql
\`\`\`

3. **Créer l'extension dans la base:**
\`\`\`sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
\`\`\`

4. **Vérifier:**
\`\`\`sql
SELECT * FROM pg_available_extensions WHERE name = 'pg_stat_statements';
\`\`\`

💡 pg_stat_statements est inclus par défaut dans PostgreSQL 10+`;
      }

      return `❌ Erreur: ${error.message}`;
    }
  },
});

// 10. Analyser l'utilisation des index
server.addTool({
  name: 'analyze_index_usage',
  description: 'Analyse l\'utilisation des index et identifie les index non utilisés',
  parameters: z.object({}),
  execute: async () => {
    try {
      const optimizer = getOptimizer();
      const indexes = await optimizer.analyzeIndexUsage();

      const unused = indexes.filter(idx => idx.usage === 0);
      const lowUsage = indexes.filter(idx => idx.usage > 0 && idx.usage < 10);

      let output = `📊 **Analyse des index (${indexes.length} trouvés)**\n\n`;

      if (unused.length > 0) {
        output += `🗑️ **Index non utilisés (${unused.length}):**\n`;
        unused.forEach(idx => {
          output += `• ${idx.indexname} sur ${idx.tablename} (${idx.size})\n`;
        });
        output += '\n💡 **Action**: Considérez supprimer ces index pour améliorer les performances d\'écriture\n\n';
      }

      if (lowUsage.length > 0) {
        output += `⚠️ **Index peu utilisés (${lowUsage.length}):**\n`;
        lowUsage.slice(0, 5).forEach(idx => {
          output += `• ${idx.indexname} sur ${idx.tablename}: ${idx.usage} utilisations (${idx.size})\n`;
        });
        output += '\n';
      }

      if (unused.length === 0 && lowUsage.length === 0) {
        output += '✅ Tous les index sont bien utilisés !\n\n';
      }

      const wellUsed = indexes.filter(idx => idx.usage >= 10);
      output += `✅ **Index bien utilisés (${wellUsed.length}):**\n`;
      wellUsed.slice(0, 3).forEach(idx => {
        output += `• ${idx.indexname} sur ${idx.tablename}: ${idx.usage} utilisations\n`;
      });

      return output;
    } catch (error: any) {
      Logger.error('❌ [analyze_index_usage]', error.message);
      return `❌ Erreur: ${error.message}`;
    }
  },
});

// 11. Analyser les statistiques des tables
server.addTool({
  name: 'analyze_table_stats',
  description: 'Affiche les statistiques détaillées des tables (scans, inserts, updates, etc.)',
  parameters: z.object({
    table: z.string().optional().describe('Table spécifique à analyser (optionnel)'),
  }),
  execute: async (args) => {
    try {
      const optimizer = getOptimizer();
      const stats = await optimizer.getTableStatistics();

      let tables = stats;
      if (args.table) {
        tables = stats.filter(s => s.tablename === args.table);
        if (tables.length === 0) {
          return `❌ Table '${args.table}' non trouvée`;
        }
      }

      let output = `📊 **Statistiques des tables**\n\n`;

      tables.forEach(table => {
        const totalOps = table.n_tup_ins + table.n_tup_upd + table.n_tup_del;
        const deadTupleRatio = table.n_live_tup > 0 ? (table.n_dead_tup / (table.n_live_tup + table.n_dead_tup)) : 0;

        output += `## 📋 ${table.tablename}\n`;
        output += `- **Lignes vivantes**: ${table.n_live_tup.toLocaleString()}\n`;
        output += `- **Lignes mortes**: ${table.n_dead_tup.toLocaleString()} (${(deadTupleRatio * 100).toFixed(1)}%)\n`;
        output += `- **Sequential scans**: ${table.seq_scan.toLocaleString()} (${table.seq_tup_read.toLocaleString()} lignes lues)\n`;
        output += `- **Index scans**: ${table.idx_scan.toLocaleString()} (${table.idx_tup_fetch.toLocaleString()} lignes via index)\n`;
        output += `- **Opérations**: ${totalOps.toLocaleString()} total\n`;
        output += `  • INSERT: ${table.n_tup_ins.toLocaleString()}\n`;
        output += `  • UPDATE: ${table.n_tup_upd.toLocaleString()}\n`;
        output += `  • DELETE: ${table.n_tup_del.toLocaleString()}\n`;

        if (deadTupleRatio > 0.2) {
          output += `⚠️ **Attention**: Ratio de tuples morts élevé (${(deadTupleRatio * 100).toFixed(1)}%) - VACUUM recommandé\n`;
        }

        output += '\n';
      });

      return output;
    } catch (error: any) {
      Logger.error('❌ [analyze_table_stats]', error.message);
      return `❌ Erreur: ${error.message}`;
    }
  },
});

// 12. Suggérer des index manquants
server.addTool({
  name: 'suggest_missing_indexes',
  description: 'Suggère des index manquants basés sur les schémas d\'accès aux données',
  parameters: z.object({}),
  execute: async () => {
    try {
      const optimizer = getOptimizer();
      const suggestions = await optimizer.suggestMissingIndexes();

      if (suggestions.length === 0) {
        return '✅ Aucune suggestion d\'index manquant détectée';
      }

      let output = `💡 **${suggestions.length} suggestions d\'index manquants**\n\n`;

      suggestions.forEach((suggestion, index) => {
        const impactEmoji = suggestion.potential_impact === 'HIGH' ? '🔴' :
                           suggestion.potential_impact === 'MEDIUM' ? '🟡' : '🟢';

        output += `${index + 1}. ${impactEmoji} **Table: ${suggestion.table}** (${suggestion.potential_impact} impact)\n`;
        output += `   Colonnes: ${suggestion.columns}\n`;
        output += `   Gain estimé: ${suggestion.estimated_gain}\n`;
        output += `   \`\`\`sql\n${suggestion.suggested_index}\n   \`\`\`\n\n`;
      });

      return output;
    } catch (error: any) {
      Logger.error('❌ [suggest_missing_indexes]', error.message);
      return `❌ Erreur: ${error.message}`;
    }
  },
});

// 13. Analyser les performances du cache
server.addTool({
  name: 'analyze_cache_performance',
  description: 'Analyse les performances du cache PostgreSQL (buffer cache hit ratio)',
  parameters: z.object({}),
  execute: async () => {
    try {
      const optimizer = getOptimizer();
      const cacheStats = await optimizer.getCacheHitRatios();

      const heapRatio = (cacheStats.heap_ratio || 0) * 100;
      const idxRatio = (cacheStats.idx_ratio || 0) * 100;

      let output = `🎯 **Performance du Cache PostgreSQL**\n\n`;

      output += `**Cache Tables**: ${heapRatio.toFixed(2)}%\n`;
      output += `**Cache Index**: ${idxRatio.toFixed(2)}%\n\n`;

      // Statistiques brutes
      output += `## 📊 Statistiques brutes\n`;
      output += `• **Heap blocks lus (disque)**: ${parseInt(cacheStats.heap_read || 0).toLocaleString()}\n`;
      output += `• **Heap blocks en cache****: ${parseInt(cacheStats.heap_hit || 0).toLocaleString()}\n`;
      output += `• **Index blocks lus (disque)**: ${parseInt(cacheStats.idx_read || 0).toLocaleString()}\n`;
      output += `• **Index blocks en cache**: ${parseInt(cacheStats.idx_hit || 0).toLocaleString()}\n\n`;

      // Analyse et recommandations
      output += `## 📊 Analyse\n`;

      if (heapRatio >= 99) {
        output += `✅ **Cache tables excellent** (${heapRatio.toFixed(2)}%)\n`;
      } else if (heapRatio >= 95) {
        output += `✅ **Cache tables bon** (${heapRatio.toFixed(2)}%)\n`;
      } else if (heapRatio >= 90) {
        output += `⚠️ **Cache tables moyen** (${heapRatio.toFixed(2)}%)\n`;
      } else if (heapRatio >= 80) {
        output += `🔴 **Cache tables faible** (${heapRatio.toFixed(2)}%)\n`;
      } else {
        output += `🚨 **Cache tables critique** (${heapRatio.toFixed(2)}%)\n`;
      }

      if (idxRatio >= 99) {
        output += `✅ **Cache index excellent** (${idxRatio.toFixed(2)}%)\n`;
      } else if (idxRatio >= 95) {
        output += `✅ **Cache index bon** (${idxRatio.toFixed(2)}%)\n`;
      } else if (idxRatio >= 90) {
        output += `⚠️ **Cache index moyen** (${idxRatio.toFixed(2)}%)\n`;
      } else if (idxRatio >= 80) {
        output += `🔴 **Cache index faible** (${idxRatio.toFixed(2)}%)\n`;
      } else {
        output += `🚨 **Cache index critique** (${idxRatio.toFixed(2)}%)\n`;
      }

      output += `\n## 💡 Recommandations\n`;

      if (heapRatio < 95 || idxRatio < 95) {
        const isCritical = heapRatio < 85 || idxRatio < 85;

        if (isCritical) {
          output += `🚨 **Action requise immédiatement**\n\n`;

          // Recommandations spécifiques avec valeurs
          output += `### 1. Configuration PostgreSQL (postgresql.conf)\n\n`;
          output += `**shared_buffers** (mémoire partagée):\n`;
          output += `• Serveur dédié: 25% de la RAM\n`;
          output += `• Serveur partagé: 10-15% de la RAM\n`;
          output += `• Exemple (8GB RAM): \`shared_buffers = 2GB\`\n`;
          output += `• Exemple (16GB RAM): \`shared_buffers = 4GB\`\n\n`;

          output += `**effective_cache_size** (estimation OS cache):\n`;
          output += `• Serveur dédié: 75% de la RAM\n`;
          output += `• Serveur partagé: 25-50% de la RAM\n`;
          output += `• Exemple (8GB RAM): \`effective_cache_size = 6GB\`\n\n`;

          output += `**random_page_cost** (coût accès aléatoire):\n`;
          output += `• Avec SSD: \`random_page_cost = 1.1\` (défaut: 4.0)\n`;
          output += `• Avec HDD: \`random_page_cost = 2.0-4.0\`\n\n`;

          output += `**work_mem** (mémoire par opération):\n`;
          output += `• Calculez: \`work_mem = (RAM - shared_buffers) / (max_connections * 3)\`\n`;
          output += `• Exemple: \`work_mem = 16MB\` ou \`work_mem = 32MB\`\n\n`;

          output += `### 2. Diagnostic approfondi\n\n`;
          output += `Exécutez ces requêtes pour identifier les tables problématiques:\n\n`;
          output += `\`\`\`sql
-- Tables avec le plus de lectures disque
SELECT
  schemaname,
  relname as table_name,
  heap_blks_read,
  heap_blks_hit,
  CASE
    WHEN heap_blks_read + heap_blks_hit > 0
    THEN (heap_blks_hit::float / (heap_blks_read + heap_blks_hit) * 100)
    ELSE 0
  END as cache_hit_ratio
FROM pg_statio_user_tables
WHERE heap_blks_read > 1000
ORDER BY heap_blks_read DESC
LIMIT 10;
\`\`\`\n\n`;

          output += `\`\`\`sql
-- Index avec le plus de lectures disque
SELECT
  schemaname,
  relname as table_name,
  indexrelname as index_name,
  idx_blks_read,
  idx_blks_hit,
  CASE
    WHEN idx_blks_read + idx_blks_hit > 0
    THEN (idx_blks_hit::float / (idx_blks_read + idx_blks_hit) * 100)
    ELSE 0
  END as cache_hit_ratio
FROM pg_statio_user_indexes
WHERE idx_blks_read > 100
ORDER BY idx_blks_read DESC
LIMIT 10;
\`\`\`\n\n`;

          output += `### 3. Actions immédiates\n\n`;
          output += `• **Redémarrez PostgreSQL** après avoir modifié postgresql.conf\n`;
          output += `• Exécutez \`ANALYZE\` sur les tables fréquemment accédées\n`;
          output += `• Vérifiez les tables avec beaucoup de sequential scans (outil: analyze_table_stats)\n`;
          output += `• Envisagez d'ajouter des index sur les colonnes fréquemment filtrées\n`;

          // Recommandations pour RAM spécifique
          output += `\n### 4. Configuration recommandée par taille de RAM\n\n`;
          output += `| RAM | shared_buffers | effective_cache_size | work_mem |\n`;
          output += `|-----|----------------|---------------------|----------|\n`;
          output += `| 4GB | 512MB | 2GB | 4MB |\n`;
          output += `| 8GB | 2GB | 6GB | 16MB |\n`;
          output += `| 16GB | 4GB | 12GB | 32MB |\n`;
          output += `| 32GB | 8GB | 24GB | 64MB |\n`;
          output += `| 64GB | 16GB | 48GB | 128MB |\n`;

        } else {
          // Cas modéré (90-95%)
          output += `• **Augmentez shared_buffers** de 10-20%\n`;
          output += `• **Vérifiez effective_cache_size** dans postgresql.conf\n`;
          output += `• **Ajustez random_page_cost** si vous utilisez un SSD (1.1 au lieu de 4.0)\n`;
          output += `• **Exécutez ANALYZE** régulièrement sur les tables actives\n`;
        }

        output += `\n### 📈 Vérification des paramètres actuels\n\n`;
        output += `Exécutez cette requête pour voir votre configuration actuelle:\n\n`;
        output += `\`\`\`sql
SELECT name, setting, unit, context
FROM pg_settings
WHERE name IN ('shared_buffers', 'effective_cache_size', 'work_mem', 'random_page_cost', 'maintenance_work_mem')
ORDER BY name;
\`\`\`\n`;

      } else {
        output += `✅ Les performances du cache sont optimales !\n`;
        output += `Aucune action nécessaire.\n`;
      }

      return output;
    } catch (error: any) {
      Logger.error('❌ [analyze_cache_performance]', error.message);
      return `❌ Erreur: ${error.message}`;
    }
  },
});

// 14. Tables nécessitant un VACUUM
server.addTool({
  name: 'analyze_vacuum_needs',
  description: 'Identifie les tables qui nécessitent un VACUUM ou ANALYZE',
  parameters: z.object({
    threshold: z.number().optional().default(0.1).describe('Seuil de tuples morts (défaut: 10%)'),
  }),
  execute: async (args) => {
    try {
      const optimizer = getOptimizer();
      const tables = await optimizer.getTablesNeedingVacuum();

      const filteredTables = tables.filter(table =>
        parseFloat(table.dead_tuple_percent) >= args.threshold
      );

      if (filteredTables.length === 0) {
        return `✅ Aucune table ne nécessite de VACUUM (seuil: ${(args.threshold * 100).toFixed(0)}%)`;
      }

      let output = `🧹 **${filteredTables.length} table(s) nécessitent un VACUUM**\n\n`;

      filteredTables.forEach((table, index) => {
        const needsVacuum = parseFloat(table.dead_tuple_percent) > 0.2;
        const emoji = needsVacuum ? '🔴' : '🟡';

        output += `${index + 1}. ${emoji} **${table.tablename}**\n`;
        output += `   Tuples morts: ${table.dead_tuple_percent}%\n`;
        output += `   Taille: ${table.table_size}\n`;
        output += `   Lignes vivantes: ${parseInt(table.n_live_tup).toLocaleString()}\n`;
        output += `   Dernier VACUUM: ${table.last_vacuum || 'Jamais'}\n`;
        output += `   Dernier AUTOVACUUM: ${table.last_autovacuum || 'Jamais'}\n`;

        if (needsVacuum) {
          output += `   \`\`\`sql\nVACUUM ANALYZE ${table.tablename};\n   \`\`\`\n`;
        }

        output += '\n';
      });

      return output;
    } catch (error: any) {
      Logger.error('❌ [analyze_vacuum_needs]', error.message);
      return `❌ Erreur: ${error.message}`;
    }
  },
});

// 15. Analyser les locks actifs
server.addTool({
  name: 'analyze_active_locks',
  description: 'Affiche les locks actifs et les requêtes en attente',
  parameters: z.object({}),
  execute: async () => {
    try {
      const optimizer = getOptimizer();
      const locks = await optimizer.getActiveLocks();
      const queries = await optimizer.getRunningQueries();

      let output = `⚡ **Analyse de l\'activité en cours**\n\n`;

      if (queries.length === 0 && locks.length === 0) {
        return '✅ Aucune requête ou lock actif détecté';
      }

      if (queries.length > 0) {
        output += `## 🔄 Requêtes en cours (${queries.length})\n`;
        queries.slice(0, 5).forEach((query, index) => {
          const duration = query.duration ? ` (${query.duration})` : '';
          output += `${index + 1}. **Utilisateur**: ${query.username}\n`;
          output += `   État: ${query.state}\n`;
          output += `   Application: ${query.application_name || 'N/A'}\n`;
          output += `   Durée${duration}\n`;
          if (query.wait_event_type && query.wait_event_type !== 'Activity') {
            output += `   ⏳ En attente: ${query.wait_event_type} - ${query.wait_event}\n`;
          }
          output += '\n';
        });
      }

      if (locks.length > 0) {
        output += `## 🔒 Locks actifs (${locks.length})\n`;
        locks.slice(0, 5).forEach((lock, index) => {
          output += `${index + 1}. **Table**: ${lock.table_name}\n`;
          output += `   Mode: ${lock.mode}\n`;
          output += `   Accordé: ${lock.granted ? '✅' : '❌'}\n`;
          output += `   Utilisateur: ${lock.username}\n`;
          if (lock.duration) {
            output += `   Durée: ${lock.duration}\n`;
          }
          output += '\n';
        });
      }

      return output;
    } catch (error: any) {
      Logger.error('❌ [analyze_active_locks]', error.message);
      return `❌ Erreur: ${error.message}`;
    }
  },
});

// 16. Générer un rapport d'optimisation complet
server.addTool({
  name: 'generate_optimization_report',
  description: 'Génère un rapport complet d\'optimisation de la base de données',
  parameters: z.object({}),
  execute: async () => {
    try {
      const optimizer = getOptimizer();
      const report = await optimizer.generateOptimizationReport();

      return report;
    } catch (error: any) {
      Logger.error('❌ [generate_optimization_report]', error.message);
      return `❌ Erreur lors de la génération du rapport: ${error.message}`;
    }
  },
});

// ============================================================================
// NETTOYAGE ET DÉMARRAGE
// ============================================================================

async function cleanup() {
  Logger.info('🧹 Nettoyage du serveur PostgreSQL MCP...');
  try {
    if (pool) {
      await pool.end();
      pool = null;
    }
    Logger.info('✅ Nettoyage terminé');
  } catch (error) {
    Logger.error('❌ Erreur lors du nettoyage:', error);
  }
}

process.on('SIGINT', async () => {
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(0);
});

// Gestion des erreurs non capturées
process.on('uncaughtException', error => {
  Logger.error('❌ Erreur non capturée:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  Logger.error('❌ Promesse rejetée non gérée:', reason);
  process.exit(1);
});

// Démarrage du serveur
async function main() {
  Logger.info('🚀 Démarrage PostgreSQL MCP Server v1.0.0...\n');

  try {
    // Tester la connexion au démarrage
    const testPool = getPool();
    const client = await testPool.connect();
    await client.query('SELECT 1');
    await client.release();

    updateGlobalState(true);
    Logger.info('✅ Connexion PostgreSQL établie\n');

    // Démarrer le serveur MCP
    await server.start();
    Logger.info('✅ Serveur MCP démarré\n');

    Logger.info('📊 Serveur PostgreSQL MCP prêt:');
    Logger.info(`   • Base: ${dbConfig.POSTGRES_DATABASE}`);
    Logger.info(`   • Hôte: ${dbConfig.POSTGRES_HOST}:${dbConfig.POSTGRES_PORT}`);
    Logger.info(`   • SSL: ${config.database.ssl !== false ? 'Activé' : 'Désactivé'}`);
    Logger.info(`   • Outils: 26 (exploration, requêtes, optimisation, performance, pg_vector)`);
  } catch (error) {
    Logger.error('❌ Erreur fatal:', error);
    await cleanup();
    process.exit(1);
  }
}

main();