#!/usr/bin/env node

import { FastMCP } from 'fastmcp';
import { Pool } from 'pg';
import config, { dbConfig } from './config.js';
import Logger from './utils/logger.js';
import { CoreTools } from './tools/coreTools.js';

console.log = (...args: any[]) => {
  Logger.info('[STDOUT REDIRECT]', ...args);
};

const server = new FastMCP({
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

function getPool(): Pool {
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

// Enregistrer les outils Core (refactorisation : 38 outils → 8 outils cohérents)
const coreTools = new CoreTools(getPool(), server);
coreTools.registerTools();

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

process.on('uncaughtException', error => {
  Logger.error('❌ Erreur non capturée:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, _promise) => {
  Logger.error('❌ Promesse rejetée non gérée:', reason);
  process.exit(1);
});

async function main() {
  Logger.info('🚀 Démarrage PostgreSQL MCP Server v1.0.0...\n');
  try {
    const testPool = getPool();
    const client = await testPool.connect();
    await client.query('SELECT 1');
    await client.release();
    updateGlobalState(true);
    Logger.info('✅ Connexion PostgreSQL établie\n');
    await server.start();
    Logger.info('✅ Serveur MCP démarré\n');
    Logger.info('📊 Serveur PostgreSQL MCP prêt:');
    Logger.info(`   • Base: ${dbConfig.POSTGRES_DATABASE}`);
    Logger.info(`   • Hôte: ${dbConfig.POSTGRES_HOST}:${dbConfig.POSTGRES_PORT}`);
    Logger.info(`   • SSL: ${config.database.ssl !== false ? 'Activé' : 'Désactivé'}`);
    Logger.info(`   • Outils: 8 (Core Tools)`);
  } catch (error: any) {
    const isConnectionError = error.code === 'ECONNREFUSED' ||
                              error.code === 'ENOTFOUND' ||
                              error.code === 'ECONNRESET' ||
                              error.message?.includes('connect ECONNREFUSED') ||
                              error.message?.includes('connect ENOTFOUND');
    if (isConnectionError) {
      Logger.error('❌ Impossible de se connecter à PostgreSQL');
      Logger.error('');
      Logger.error('🔍 Problème détecté: La base de données PostgreSQL n\'est pas accessible');
      Logger.error('');
      Logger.error('📋 Solutions possibles:');
      Logger.error('   1. Démarrer PostgreSQL:');
      if (process.platform === 'win32') {
        Logger.error('      pg_ctl -D "C:\\Program Files\\PostgreSQL\\XX\\data" start');
      } else {
        Logger.error('      sudo service postgresql start');
        Logger.error('      ou: sudo systemctl start postgresql');
      }
      Logger.error('');
      Logger.error('   2. Vérifier la configuration dans .env:');
      Logger.error(`      • Hôte: ${dbConfig.POSTGRES_HOST}:${dbConfig.POSTGRES_PORT}`);
      Logger.error(`      • Base: ${dbConfig.POSTGRES_DATABASE}`);
      Logger.error(`      • Utilisateur: ${dbConfig.POSTGRES_USER}`);
      Logger.error('');
      Logger.error('   3. Démarrer avec Docker:');
      Logger.error('      docker run --name postgres-mcp -e POSTGRES_PASSWORD=9022 \\');
      Logger.error('        -e POSTGRES_USER=postgres -e POSTGRES_DB=financial_analyst \\');
      Logger.error('        -p 5432:5432 -d postgres:15');
      Logger.error('');
      Logger.error('💡 Erreur technique:', error.code || error.message);
    } else {
      Logger.error('❌ Erreur fatal:', error);
    }
    await cleanup();
    process.exit(1);
  }
}
main();
