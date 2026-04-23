#!/usr/bin/env node

import { Pool } from "pg";
import { FastMCP } from "fastmcp";
import config, { dbConfig } from "./config.js";
import Logger from "./utils/logger.js";
import { CoreTools } from "./tools/coreTools.js";

// Force all console.log to console.error to avoid breaking MCP protocol (stdio)
console.log = (...args) => {
  console.error(...args);
};

// 🚑 Emergency Recovery: Handle unhandled errors to log them before exiting
process.on("uncaughtException", (error) => {
  Logger.error("🔥 UNCAUGHT EXCEPTION:", error);
  process.stderr.write(`Fata Error: ${error.message}\n`);
  setTimeout(() => process.exit(1), 100);
});

process.on("unhandledRejection", (reason) => {
  Logger.error("🌊 UNHANDLED REJECTION:", reason);
  process.stderr.write(`Unhandled Rejection: ${reason}\n`);
});

/**
 * Singleton MCP Server instance
 */
export const server = new FastMCP({
  name: "postgresql-mcp-server",
  version: "1.0.0",
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
    pool.on("connect", () => {
      Logger.info("🔗 Nouvelle connexion PostgreSQL établie");
      globalState.connectionCount++;
      updateGlobalState(true);
    });
    pool.on("error", (err) => {
      Logger.error("❌ Erreur du pool PostgreSQL:", err);
      updateGlobalState(false, err.message);
    });
    pool.on("remove", () => {
      globalState.connectionCount--;
      Logger.debug(
        `📤 Connexion retirée du pool. Total: ${globalState.connectionCount}`,
      );
    });
  }
  return pool;
}

function updateGlobalState(connected: boolean, error?: string) {
  globalState.isConnected = connected;
  globalState.lastError = error || null;
  if (connected && pool) {
    globalState.connectionInfo = {
      host:
        config.database.connectionString?.split("@")[1]?.split("/")[0] ||
        "localhost",
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
  Logger.info("🧹 Nettoyage du serveur PostgreSQL MCP...");
  try {
    if (pool) {
      await pool.end();
      pool = null;
    }
    Logger.info("✅ Nettoyage terminé");
  } catch (error) {
    Logger.error("❌ Erreur lors du nettoyage:", error);
  }
}

// Re-export core services for library usage
export { CoreTools } from "./tools/coreTools.js";
export { IntelligentSearchService } from "./services/intelligentSearchService.js";
export { embeddingService } from "./services/embeddingService.js";
export { HybridSearchService } from "./services/hybridSearchService.js";
export { default as config, dbConfig, postgresConfig } from "./config.js";

// If this file is run directly, start the server
async function runServer() {
  try {
    // 1. Log startup info to logs file (NOT stdout)
    Logger.debug(`📂 CWD: ${process.cwd()}`);
    Logger.debug(`📂 Service Dir: ${import.meta.url}`);

    // 2. Register tools before starting
    const coreTools = new CoreTools(getPool(), server);
    coreTools.registerTools();

    // 3. Start the MCP server IMMEDIATELY to answer the "initialize" request
    // FastMCP.start() handles the stdio/sse transport connection
    await server.start();
    Logger.info("✅ Serveur MCP démarré sur stdio\n");

    // 4. Perform DB connection check in the background
    // This prevents "initialize: EOF" if the DB is slow or credentials are wrong
    setTimeout(async () => {
      try {
        const testPool = getPool();
        const client = await testPool.connect();
        await client.query("SELECT 1");
        await client.release();
        updateGlobalState(true);
        Logger.info(
          `✅ Connexion PostgreSQL validée: ${dbConfig.POSTGRES_DATABASE}`,
        );
        
        // 5. Audit Loop: Log pool connection saturation every 5 minutes (INC-A1)
        setInterval(() => {
          if (globalState.connectionCount > 10) {
            Logger.warn(`⚠️ [AUDIT] Pool PostgreSQL - Active Connections: ${globalState.connectionCount} (Max allowed: ${config.database.max})`);
          } else {
            Logger.debug(`📊 [AUDIT] Pool PostgreSQL - Active Connections: ${globalState.connectionCount}`);
          }
        }, 5 * 60 * 1000);
        
      } catch (error: any) {
        Logger.error("❌ Échec de connexion DB initiale:", error.message);
        updateGlobalState(false, error.message);
      }
    }, 100);
  } catch (error: any) {
    // Crucial: errors in runServer must go to stderr to avoid corrupting stdout
    process.stderr.write(`❌ Erreur fatale au démarrage: ${error.message}\n`);
    await cleanup();
    process.exit(1);
  }
}

// ----------------------------------------------------------------------------
// ROBUST MAIN ENTRY DETECTION (ESM + WINDOWS)
// ----------------------------------------------------------------------------
import url from "url";
const currentFilePath = url
  .fileURLToPath(import.meta.url)
  .replace(/\\/g, "/")
  .toLowerCase();
const entryPath = process.argv[1]?.replace(/\\/g, "/").toLowerCase();

const isMain =
  entryPath &&
  (currentFilePath.includes(entryPath) ||
    entryPath.includes(currentFilePath) ||
    entryPath.endsWith("dist/index.js") ||
    entryPath.endsWith("src/index.ts"));

if (isMain) {
  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await cleanup();
    process.exit(0);
  });

  runServer();
}
