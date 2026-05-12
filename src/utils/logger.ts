import pino from "pino";
import path from "path";

/**
 * ============================================================================
 * SUPER-PINO LOGGER - PostgreSQL Edition
 * ============================================================================
 */

const REDACT_PATHS = [
  "*.password",
  "*.api_key",
  "*.token",
  "*.secret",
  "req.headers.authorization",
  "*.email",
  "db.password",
  "POSTGRES_PASSWORD",
];

const DEFAULT_LOG_DIR = path.join(process.cwd(), "logs");
const DEFAULT_LOG_FILE = path.join(DEFAULT_LOG_DIR, "nexus-postgresql.log");
const GLOBAL_LOG_PATH = "C:\\SierraChart\\ACS_Source\\BTCacsil\\logs\\nexus-postgresql.log";

function getFileTargets(): string[] {
  const raw = process.env.LOG_FILES ?? "";
  const paths = raw.split(",").map(p => p.trim()).filter(Boolean);
  const userPaths = paths.map(p => path.isAbsolute(p) ? p : path.resolve(process.cwd(), p));
  return [DEFAULT_LOG_FILE, GLOBAL_LOG_PATH, ...userPaths];
}

const fileTargets = getFileTargets();

const transport = pino.transport({
  targets: [
    {
      target: "pino-pretty",
      level: process.env.LOG_LEVEL || "debug",
      options: {
        destination: 2, // STDERR for MCP compatibility
        colorize: true,
        translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
        ignore: "pid,hostname,service,version",
        messageFormat: "\x1b[34m[{module}]\x1b[0m {msg}", // Blue for Postgres
        errorLikeObjectKeys: ["err", "error"],
      } as any,
    },
    ...fileTargets.map((filePath) => ({
      target: "pino-roll",
      level: process.env.LOG_LEVEL || "info",
      options: {
        file: filePath,
        frequency: "daily",
        dateFormat: "yyyy-MM-dd",
        size: "50m",
        limit: { count: 30 },
        mkdir: true,
      },
    })),
  ],
});

export const rootLogger = pino(
  {
    name: "postgresql-mcp",
    level: process.env.LOG_LEVEL || "info",
    redact: {
      paths: REDACT_PATHS,
      censor: "[CONFIDENTIEL]",
    },
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
    base: {
      service: "postgresql-mcp-server",
      version: "1.3.0",
    },
  },
  transport
);

// Specialized Child Loggers
export const dbLogger     = rootLogger.child({ module: "DATABASE" });
export const serverLogger = rootLogger.child({ module: "SERVER" });
export const toolLogger   = rootLogger.child({ module: "TOOL" });
export const vectorLogger = rootLogger.child({ module: "VECTOR" });

rootLogger.info({ targets: fileTargets }, "Super-Pino V2.0 initialized for PostgreSQL-MCP");

export default rootLogger;

