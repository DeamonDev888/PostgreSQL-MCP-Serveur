import { config } from 'dotenv';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Obtenir le chemin du fichier de configuration
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Charger les variables d'environnement
// 1. Rechercher dans le dossier du package (utile pour les serveurs MCP installés localement)
config({ path: resolve(__dirname, '../.env') });
// 2. Rechercher dans le dossier de travail actuel (utile pour les déploiements personnalisés)
config({ path: resolve(process.cwd(), '.env') });

// Schéma de validation pour la configuration
const ConfigSchema = z.object({
  // Configuration PostgreSQL
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_DATABASE: z.string().min(1),
  POSTGRES_SSL: z.enum(['true', 'false']).transform(val => val === 'true').default('false'),
  POSTGRES_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(10),
  POSTGRES_IDLE_TIMEOUT: z.coerce.number().int().min(1000).default(30000),

  // Connection string optionnelle (override les autres paramètres)
  POSTGRES_CONNECTION_STRING: z.string().optional(),

  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

// Valider et parser la configuration
const configResult = ConfigSchema.safeParse(process.env);

if (!configResult.success) {
  console.error('⚠️ [postgresql-mcp-server] Configuration invalide ou incomplète:');
  console.error(JSON.stringify(configResult.error.format(), null, 2));
}

// Ensure data exists even on failure for library safety
export const dbConfig = configResult.success ? configResult.data : {
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: 5432,
  POSTGRES_USER: '',
  POSTGRES_PASSWORD: '',
  POSTGRES_DATABASE: '',
  POSTGRES_SSL: false,
  POSTGRES_MAX_CONNECTIONS: 10,
  POSTGRES_IDLE_TIMEOUT: 30000,
  NODE_ENV: 'development'
} as any;

// Construire la configuration de connexion
export const postgresConfig: any = dbConfig.POSTGRES_CONNECTION_STRING ? {
  connectionString: dbConfig.POSTGRES_CONNECTION_STRING,
  ssl: dbConfig.POSTGRES_SSL ? { rejectUnauthorized: false } : false,
  max: dbConfig.POSTGRES_MAX_CONNECTIONS,
  idleTimeoutMillis: dbConfig.POSTGRES_IDLE_TIMEOUT,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
  query_timeout: 30000,
} : {
  host: dbConfig.POSTGRES_HOST,
  port: dbConfig.POSTGRES_PORT,
  user: dbConfig.POSTGRES_USER,
  password: dbConfig.POSTGRES_PASSWORD || '',
  database: dbConfig.POSTGRES_DATABASE,
  ssl: dbConfig.POSTGRES_SSL ? { rejectUnauthorized: false } : false,
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
  isDevelopment: dbConfig.NODE_ENV === 'development',
  isProduction: dbConfig.NODE_ENV === 'production',
  ...dbConfig,
};