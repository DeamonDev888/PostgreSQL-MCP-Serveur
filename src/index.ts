#!/usr/bin/env node

import { Pool } from 'pg';
import { FastMCP } from 'fastmcp';
import config, { dbConfig } from './config.js';
import Logger from './utils/logger.js';
import { CoreTools } from './tools/coreTools.js';

/**
 * Singleton MCP Server instance
 */
export const server = new FastMCP({
  name: 'postgresql-mcp-server',
  version: '1.0.0',
});

let pool: Pool | null = null;

const globalState = {
  isConnected: false,
  connectionInfo: null as any,
  lastError: null as string | null,
  connectionCount: 0,
};

/**
 * Gets the PostgreSQL connection pool
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(config.database);
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

/**
 * Closes connections and cleans up
 */
export async function cleanup() {
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

// Re-export core services for library usage
export { CoreTools } from './tools/coreTools.js';
export { IntelligentSearchService } from './services/intelligentSearchService.js';
export { embeddingService } from './services/embeddingService.js';
export { HybridSearchService } from './services/hybridSearchService.js';
export { default as config, dbConfig, postgresConfig } from './config.js';

// If this file is run directly, start the server
async function runServer() {
  Logger.debug(`📂 CWD: ${process.cwd()}`);
  Logger.debug(`📂 Service Dir: ${import.meta.url}`);
  Logger.info('🚀 Démarrage PostgreSQL MCP Server v1.0.0...\n');
  try {
    const testPool = getPool();
    const client = await testPool.connect();
    await client.query('SELECT 1');
    await client.release();
    updateGlobalState(true);
    
    // Register tools
    const coreTools = new CoreTools(getPool(), server);
    coreTools.registerTools();

    Logger.info('✅ Connexion PostgreSQL établie\n');
    await server.start();
    Logger.info('✅ Serveur MCP démarré\n');
    Logger.info('📊 Serveur PostgreSQL MCP prêt:');
    Logger.info(`   • Base: ${dbConfig.POSTGRES_DATABASE}`);
    Logger.info(`   • Hôte: ${dbConfig.POSTGRES_HOST}:${dbConfig.POSTGRES_PORT}`);
    Logger.info(`   • SSL: ${config.database.ssl !== false ? 'Activé' : 'Désactivé'}`);
    Logger.info(`   • Outils: 8 (Core Tools)`);
  } catch (error: any) {
    Logger.error('❌ Erreur fatale au démarrage:', error);
    await cleanup();
    process.exit(1);
  }
}

// Simple check for CLI execution in ESM
const normalizedArgv = process.argv[1]?.replace(/\\/g, '/');
const isMain = normalizedArgv?.includes('dist/index.js') || normalizedArgv?.includes('src/index.ts');
if (isMain) {
  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(0);
  });

  runServer();
}
