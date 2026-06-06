#!/usr/bin/env node

import { Pool } from "pg";
import { FastMCP } from "fastmcp";
import { ZodError } from "zod";
import config, { dbConfig } from "./config.js";
import { serverLogger, dbLogger, rootLogger } from "./utils/logger.js";

import { CoreTools } from "./tools/coreTools.js";
import { DBOptimizer } from "./utils/dbOptimizer.js";

// 🛡️ ULTIMATE SHIELD: Proxy process.stdout.write to redirect non-JSON data to stderr
// This is critical to prevent ZodError in the parent orchestrator due to malformed JSON-RPC
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function (
  chunk: string | Uint8Array,
  encoding?: BufferEncoding | ((err?: Error | null) => void),
  callback?: (err?: Error | null) => void,
): boolean {
  const str = typeof chunk === "string" ? chunk : chunk.toString();
  const trimmed = str.trim();

  if (typeof encoding === "function") {
    callback = encoding as (err?: Error | null) => void;
    encoding = undefined;
  }

  // Allow JSON-RPC (starts with {) and empty/newline chunks
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed === "") {
    // Additional safety: block arrays as they cause ZodError in most MCP SDKs
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          serverLogger.warn(
            { raw: str },
            "🛡️ [SHIELD] Blocked array-as-JSON-RPC on stdout",
          );
          return process.stderr.write(
            chunk,
            encoding as BufferEncoding,
            callback,
          );
        }
      } catch {
        // Not valid JSON, redirect to stderr
        return process.stderr.write(
          chunk,
          encoding as BufferEncoding,
          callback,
        );
      }
    }
    return originalStdoutWrite(chunk, encoding as BufferEncoding, callback);
  }

  // Redirect everything else to stderr
  return process.stderr.write(chunk, encoding as BufferEncoding, callback);
} as typeof process.stdout.write;

/**
 * Format ZodError for human-readable output
 */
function formatZodError(error: ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `[${issue.path.join(".")}]` : "";
    return `  - ${path} ${issue.message}`;
  });
  return `ZodError:\n${issues.join("\n")}`;
}

/**
 * ⚠️ CRITICAL: Redirect all console logs to Pino (Stderr)
 * This prevents log messages from corrupting the MCP stdout stream
 * while ensuring they are captured in both console (stderr) and file logs.
 */
console.log = (...args) => {
  serverLogger.info({ consoleArgs: args }, "Captured console.log");
};

console.error = (...args) => {
  const firstArg = args[0];
  const secondArg = args[1];

  // 🛡️ INTELLIGENT FILTER: Silence FastMCP transport noise (ZodError on shell argv leakage)
  // We use a more robust check here as ANSI codes or slight formatting changes can bypass simple includes
  const isFastMCPError =
    typeof firstArg === "string" &&
    (firstArg.includes("[FastMCP error]") ||
      firstArg.toLowerCase().includes("fastmcp"));

  if (isFastMCPError && secondArg && typeof secondArg === "object") {
    const isZodError =
      (secondArg as any).name === "ZodError" || secondArg instanceof ZodError;

    if (isZodError) {
      const errorMsg = (secondArg as any).message || "";
      // Check for the "array-sent-instead-of-object" signature (numeric keys "0", "1", "2"...)
      // This is typical transport noise from shell environments leaking into stdin
      const hasNumericKeys =
        /"0"/.test(errorMsg) ||
        /'0'/.test(errorMsg) ||
        errorMsg.includes("unrecognized_keys");
      const hasMethodIssue =
        errorMsg.includes("method") && errorMsg.includes("undefined");

      if (hasNumericKeys && hasMethodIssue) {
        serverLogger.debug(
          { transportNoise: true, zodError: secondArg },
          "🛡️ [SHIELD] Filtered FastMCP transport noise (handshake ZodError)",
        );
        return;
      }

      // For other ZodErrors, log as WARN instead of ERROR to avoid triggering "system failure" alerts
      serverLogger.warn(
        { zodError: secondArg, firstArg },
        "⚠️ FastMCP Validation Warning",
      );
      return;
    }
  }

  // Fallback for non-FastMCP errors or failed matching
  serverLogger.error({ consoleArgs: args }, "Captured console.error");
};

// 🚑 Emergency Recovery: Handle unhandled errors to log them before exiting
process.on("uncaughtException", (error) => {
  // Handle ZodError specifically
  if (error instanceof ZodError) {
    serverLogger.error(
      { err: formatZodError(error), validation: error.issues },
      "🔍 ZOD VALIDATION ERROR - Invalid input received",
    );
    rootLogger.flush();
    // Don't exit for validation errors - just log them
    return;
  }
  serverLogger.error({ err: error }, "🔥 UNCAUGHT EXCEPTION");
  rootLogger.flush();
  setTimeout(() => process.exit(1), 100);
});

process.on("unhandledRejection", (reason) => {
  // Handle ZodError in rejections
  if (reason instanceof ZodError) {
    serverLogger.error(
      { err: formatZodError(reason), validation: reason.issues },
      "🔍 ZOD VALIDATION ERROR (rejection)",
    );
    return;
  }
  serverLogger.error({ err: reason }, "🌊 UNHANDLED REJECTION");
  rootLogger.flush();
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
  connectionInfo: null as Record<string, unknown> | null,
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
      dbLogger.info("🔗 Nouvelle connexion PostgreSQL établie");
      globalState.connectionCount++;
      updateGlobalState(true);
    });
    pool.on("error", (err) => {
      dbLogger.error({ err }, "❌ Erreur du pool PostgreSQL");
      updateGlobalState(false, err.message);
    });
    pool.on("remove", () => {
      globalState.connectionCount--;
      dbLogger.debug(
        { connectionCount: globalState.connectionCount },
        "📤 Connexion retirée du pool",
      );
    });
  }
  return pool;
}

function updateGlobalState(connected: boolean, error?: string) {
  globalState.isConnected = connected;
  globalState.lastError = error || null;
  if (connected && pool) {
    let displayHost = "localhost";
    try {
      const cs = config.database.connectionString;
      if (cs) {
        const url = new URL(cs);
        displayHost = url.hostname;
      } else {
        displayHost = dbConfig.POSTGRES_HOST;
      }
    } catch {
      displayHost = "localhost";
    }
    globalState.connectionInfo = {
      host: displayHost,
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
  serverLogger.info("🧹 Nettoyage du serveur PostgreSQL MCP...");
  try {
    if (pool) {
      await pool.end();
      pool = null;
    }
    serverLogger.info("✅ Nettoyage terminé");
  } catch (error) {
    serverLogger.error({ err: error }, "❌ Erreur lors du nettoyage");
  }
  rootLogger.flush();
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
    serverLogger.debug(
      { cwd: process.cwd(), serviceDir: import.meta.url },
      "🚀 [BOOT] Initializing PostgreSQL MCP Server",
    );

    const pool = getPool();

    // 1. Database Pre-flight Check (Wait for DB to be ready)
    let isReady = false;
    let retries = 5;
    while (retries > 0 && !isReady) {
      try {
        const client = await pool.connect();
        const res = await client.query("SELECT 1 as health");
        client.release();

        if (res.rows[0].health === 1) {
          isReady = true;
          serverLogger.info(
            "🐘 [BOOT] Database connection established and verified",
          );
        }
      } catch (err: any) {
        retries--;
        serverLogger.warn(
          { err: err.message, retriesLeft: retries },
          "🐘 [BOOT] Database not ready yet, retrying...",
        );
        if (retries > 0) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    if (!isReady) {
      serverLogger.error(
        "❌ [BOOT] Fatal: Could not connect to database after multiple retries.",
      );
      // We still start the server but in "degraded" mode so agents can at least see why it's failing
    }

    // 2. Register tools
    const coreTools = new CoreTools(pool, server);
    coreTools.registerTools();

    // 3. Start the MCP server
    const port = parseInt(process.env.FASTMCP_PORT || "5433", 10);
    const host = process.env.FASTMCP_HOST || "localhost";
    const endpoint = process.env.FASTMCP_ENDPOINT || "/mcp";
    await server.start({
      transportType: "httpStream",
      httpStream: {
        port,
        host,
        endpoint: endpoint as `/${string}`,
        stateless: true,
      },
    });
    serverLogger.info(
      `✅ [BOOT] MCP Server started on HTTP SSE ${host}:${port}${endpoint}`,
    );

    // 4. Background Maintenance & Monitoring
    if (isReady) {
      // Periodic health audit
      const auditInterval = setInterval(
        async () => {
          try {
            if (globalState.connectionCount > config.database.max * 0.8) {
              serverLogger.warn(
                {
                  connectionCount: globalState.connectionCount,
                  max: config.database.max,
                },
                "⚠️ [MONITOR] Pool saturation detected",
              );
            }

            // Background optimization check
            const optimizer = new DBOptimizer(pool);
            await optimizer.analyzeIndexUsage();
          } catch (err: any) {
            serverLogger.error(
              { err: err.message },
              "❌ [MONITOR] Background audit failed",
            );
          }
        },
        5 * 60 * 1000,
      );

      auditInterval.unref();

      // Update global state for diagnostic tools
      updateGlobalState(true);
    }
  } catch (error: any) {
    serverLogger.fatal(
      { err: error },
      "❌ [BOOT] Fatal error during startup sequence",
    );
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
  (entryPath === currentFilePath ||
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
