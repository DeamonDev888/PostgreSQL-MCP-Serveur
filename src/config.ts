import { config } from 'dotenv';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Obtenir le chemin du fichier de configuration
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Charger les variables d'environnement depuis le .env du serveur
config({ path: resolve(__dirname, '../.env') });

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
  console.error('❌ Configuration invalide:');
  console.error(configResult.error.format());
  process.exit(1);
}

export const dbConfig = configResult.data;

// Construire la configuration de connexion
export const postgresConfig = {
  // Si une connection string est fournie, l'utiliser
  connectionString: dbConfig.POSTGRES_CONNECTION_STRING ||
    `postgresql://${dbConfig.POSTGRES_USER}:${dbConfig.POSTGRES_PASSWORD}@${dbConfig.POSTGRES_HOST}:${dbConfig.POSTGRES_PORT}/${dbConfig.POSTGRES_DATABASE}`,

  // Configuration SSL
  ssl: dbConfig.POSTGRES_SSL ? { rejectUnauthorized: false } : false,

  // Pool de connexions
  max: dbConfig.POSTGRES_MAX_CONNECTIONS,
  idleTimeoutMillis: dbConfig.POSTGRES_IDLE_TIMEOUT,

  // Autres options recommandées
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