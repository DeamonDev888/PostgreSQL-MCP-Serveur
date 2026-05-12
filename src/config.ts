import { config } from "dotenv";
import { z } from "zod";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fs from "fs";

// Obtenir le chemin du fichier de configuration
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// 🚨 VALIDATION CRITIQUE DU .ENV
// =============================================================================
const searchPaths = [
  resolve(__dirname, "../../.env"),
  resolve(__dirname, "../.env"),
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../Workflow/.env"),
  resolve(dirname(fileURLToPath(import.meta.url)), "../../Workflow/.env"),
];

let envLoaded = false;
let envPathUsed = "";

for (const p of searchPaths) {
  if (fs.existsSync(p)) {
    config({ path: p });
    envLoaded = true;
    envPathUsed = p;
    break;
  }
}

// ─── VERIFICATIONS OBLIGATOIRES ───────────────────────────────────────────────
const missingVars: string[] = [];
const warningVars: string[] = [];

// PostgreSQL auth critiques
if (!process.env.POSTGRES_USER || process.env.POSTGRES_USER.trim() === "") {
  missingVars.push("POSTGRES_USER");
}
if (!process.env.POSTGRES_PASSWORD || process.env.POSTGRES_PASSWORD.trim() === "") {
  missingVars.push("POSTGRES_PASSWORD");
}
if (!process.env.POSTGRES_DATABASE || process.env.POSTGRES_DATABASE.trim() === "") {
  missingVars.push("POSTGRES_DATABASE");
}

// OpenRouter (pour embeddings - utilisé par Overmind/Workflow)
const localOpenRouterKey = process.env.OPENROUTER_API_KEY?.trim();
const workflowOpenRouterKey =
  process.env.OVERMIND_EMBEDDING_KEY?.trim() ||
  process.env.OPEN_ROUTER_API_KEY?.trim();

if (!localOpenRouterKey && !workflowOpenRouterKey) {
  missingVars.push("OPENROUTER_API_KEY (requis pour embeddings)");
} else if (!localOpenRouterKey && workflowOpenRouterKey) {
  warningVars.push("OPENROUTER_API_KEY utilisé depuis Workflow/.env (fallback)");
}

if (!process.env.EMBEDDING_PROVIDER && localOpenRouterKey) {
  warningVars.push("EMBEDDING_PROVIDER (défaut: openrouter)");
}

// Affichage des erreurs critiques AVANT la validation Zod
if (!envLoaded) {
  console.error("");
  console.error("╔══════════════════════════════════════════════════════════════════════════════╗");
  console.error("║  🚨 FATAL ERROR: AUCUN .env TROUVÉ                                         ║");
  console.error("╠══════════════════════════════════════════════════════════════════════════════╣");
  console.error("║  Le serveur MCP PostgreSQL n'a pas trouvé de fichier .env.                  ║");
  console.error("║                                                                              ║");
  console.error("║  Chemins recherchés:                                                        ║");
  searchPaths.forEach((p) => {
    console.error(`║    - ${p.padEnd(76)}║`);
  });
  console.error("║                                                                              ║");
  console.error("║  SOLUTION: Créez un fichier .env avec les variables requises:              ║");
  console.error("║                                                                              ║");
  console.error("║    POSTGRES_HOST=localhost                                                 ║");
  console.error("║    POSTGRES_PORT=5432                                                      ║");
  console.error("║    POSTGRES_USER=postgres                                                  ║");
  console.error("║    POSTGRES_PASSWORD=votre_password                                         ║");
  console.error("║    POSTGRES_DATABASE=financial_analyst                                     ║");
  console.error("║                                                                              ║");
  console.error("║  Emplacement attendu:                                                      ║");
  console.error(`║    ${__dirname}/.env                                                              ║`);
  console.error("╚══════════════════════════════════════════════════════════════════════════════╝");
  console.error("");
  process.exit(1);
}

if (missingVars.length > 0) {
  console.error("");
  console.error("╔══════════════════════════════════════════════════════════════════════════════╗");
  console.error("║  🚨 FATAL ERROR: VARIABLES POSTGRESQL MANQUANTES                           ║");
  console.error("╠══════════════════════════════════════════════════════════════════════════════╣");
  console.error("║  Les variables suivantes sont OBLIGATOIRES pour démarrer le serveur:        ║");
  missingVars.forEach((v) => {
    console.error(`║    ❌ ${v.padEnd(74)}║`);
  });
  console.error("║                                                                              ║");
  console.error("║  Fichier .env chargé: " + envPathUsed.padEnd(50) + "║");
  console.error("║                                                                              ║");
  console.error("║  SUPPRESSION: Éditez le fichier .env et ajoutez les variables manquantes.   ║");
  console.error("╚══════════════════════════════════════════════════════════════════════════════╝");
  console.error("");
  process.exit(1);
}

if (warningVars.length > 0) {
  console.error("");
  console.error("╔══════════════════════════════════════════════════════════════════════════════╗");
  console.error("║  ⚠️  WARNING: VARIABLES EMBEDDING MANQUANTES                               ║");
  console.error("╠══════════════════════════════════════════════════════════════════════════════╣");
  console.error("║  Ces variables sont nécessaires pour les embeddings OverMind:               ║");
  warningVars.forEach((v) => {
    console.error(`║    ⚠️  ${v.padEnd(74)}║`);
  });
  console.error("║                                                                              ║");
  console.error("║  Sans ces variables, les fonctionnalités de recherche sémantique           ║");
  console.error("║  et de mémorisation vectorielle ne fonctionneront pas.                      ║");
  console.error("║                                                                              ║");
  console.error("║  Pour corriger, ajoutez au .env:                                           ║");
  console.error("║                                                                              ║");
  console.error("║    OPENROUTER_API_KEY=sk-or-v1-votre_clef_openrouter                       ║");
  console.error("║    EMBEDDING_PROVIDER=openrouter                                           ║");
  console.error("║    EMBEDDING_DIMENSIONS=4096                                               ║");
  console.error("║    OPENROUTER_MODEL=qwen/qwen3-embedding-8b                                ║");
  console.error("╚══════════════════════════════════════════════════════════════════════════════╝");
  console.error("");
  // Warning ne fait pas sortir, juste un avertissement
}

// Charger les variables d'environnement de manière robuste
for (const p of searchPaths) {
  if (fs.existsSync(p)) {
    config({ path: p });
  }
}

// ─── FALLBACK: Charger aussi le .env d'Overmind Workflow ──────────────────────
// Ce fallback fournit les credentials OpenRouter/Embeddings depuis Workflow/.env
// si ils ne sont pas définis dans le .env local du serveur MCP.
const workflowEnvPath = resolve(__dirname, "../../Workflow/.env");
if (fs.existsSync(workflowEnvPath)) {
  config({ path: workflowEnvPath, override: false }); // override=false = ne remplace pas les vars existantes
}

// ─── Fallback explicite des variables OpenRouter/Embeddings ─────────────────────
// Si OPENROUTER_API_KEY n'est pas défini localement, essaier les vars Overmind
const openRouterKeyVar =
  process.env.OPENROUTER_API_KEY ||
  process.env.OVERMIND_EMBEDDING_KEY ||
  process.env.OPEN_ROUTER_API_KEY;

if (!process.env.OPENROUTER_API_KEY && openRouterKeyVar) {
  process.env.OPENROUTER_API_KEY = openRouterKeyVar;
  console.error("🔓 [CONFIG] OPENROUTER_API_KEY chargé depuis Workflow/.env (fallback)");
}

// Fallback pour les autres vars embedding
if (!process.env.OVERMIND_EMBEDDING_URL && process.env.OPENROUTER_API_KEY) {
  // Only set from Workflow if not already locally
}
if (!process.env.OVERMIND_EMBEDDING_MODEL && process.env.OPENROUTER_API_KEY) {
  // Model n'est pas critique — un default est appliqué dans embeddingService
}

// ─── Validation PostgreSQL & Embedding (après fallback) ─────────────────────────

// Schéma de validation pour la configuration
const ConfigSchema = z.object({
  // Configuration PostgreSQL
  POSTGRES_HOST: z.string().default("localhost"),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_DATABASE: z.string().min(1),
  POSTGRES_SSL: z
    .enum(["true", "false"])
    .transform((val) => val === "true")
    .default("false"),
  POSTGRES_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(10),
  POSTGRES_IDLE_TIMEOUT: z.coerce.number().int().min(1000).default(30000),

  // Connection string optionnelle (override les autres paramètres)
  POSTGRES_CONNECTION_STRING: z.string().optional(),

  // Environment
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

// Valider et parser la configuration
const configResult = ConfigSchema.safeParse(process.env);

if (!configResult.success) {
  console.error(
    "⚠️ [postgresql-mcp-server] Configuration invalide ou incomplète:",
  );
  console.error(JSON.stringify(configResult.error.format(), null, 2));
  if (process.env.NODE_ENV !== "test") {
    process.exit(1);
  }
}

type DbConfig = z.infer<typeof ConfigSchema>;

export const dbConfig: DbConfig = configResult.success
  ? configResult.data
  : {
      POSTGRES_HOST: "localhost",
      POSTGRES_PORT: 5432,
      POSTGRES_USER: "",
      POSTGRES_PASSWORD: "",
      POSTGRES_DATABASE: "",
      POSTGRES_SSL: false,
      POSTGRES_MAX_CONNECTIONS: 10,
      POSTGRES_IDLE_TIMEOUT: 30000,
      NODE_ENV: "test" as const,
      POSTGRES_CONNECTION_STRING: undefined,
    };

// Construire la configuration de connexion
const sslConfig = dbConfig.POSTGRES_SSL
  ? { rejectUnauthorized: dbConfig.NODE_ENV === "production" }
  : false;

export const postgresConfig = dbConfig.POSTGRES_CONNECTION_STRING
  ? {
      connectionString: dbConfig.POSTGRES_CONNECTION_STRING,
      ssl: sslConfig,
      max: dbConfig.POSTGRES_MAX_CONNECTIONS,
      idleTimeoutMillis: dbConfig.POSTGRES_IDLE_TIMEOUT,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
      query_timeout: 30000,
    }
  : {
      host: dbConfig.POSTGRES_HOST,
      port: dbConfig.POSTGRES_PORT,
      user: dbConfig.POSTGRES_USER,
      password: dbConfig.POSTGRES_PASSWORD || "",
      database: dbConfig.POSTGRES_DATABASE,
      ssl: sslConfig,
      max: dbConfig.POSTGRES_MAX_CONNECTIONS,
      idleTimeoutMillis: dbConfig.POSTGRES_IDLE_TIMEOUT,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
      query_timeout: 30000,
    };

// Exporter la configuration pour utilisation
export default {
  database: postgresConfig,
  env: dbConfig.NODE_ENV,
  isDevelopment: dbConfig.NODE_ENV === "development",
  isProduction: dbConfig.NODE_ENV === "production",
  ...dbConfig,
};
