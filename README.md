# PostgreSQL MCP Server & Library

A comprehensive Model Context Protocol (MCP) server for PostgreSQL interaction, which also doubles as an importable TypeScript library for intelligent search and embeddings.

## 🚀 Features

- **MCP Tool Suite**: 8 high-level tools for database interaction (diagnose, explore, search, query, insert, etc.).
- **Vector Intelligence**: Native support for `pgvector` with automatic embedding generation (OpenRouter/OpenAI).
- **Intelligent Search**: Hybrid search (text + vector) with automatic mode detection.
- **Physical Isolation**: Support for "Database-per-Agent" architecture when used with OverMind.
- **Resilient**: Graceful fallbacks for missing extensions (vector, trgm).

## 📦 Installation

```bash
pnpm install postgresql-mcp-server
```

## 🛠️ Library Usage

You can import services directly into your TypeScript project:

```typescript
import { embedText } from "postgresql-mcp-server/services/embeddings";

const { embedding, model } = await embedText("Hello world");
```

### Configuration

The library uses environment variables or programmatic configuration:

- `OVERMIND_EMBEDDING_URL`: URL to your embedding API (e.g. OpenRouter).
- `OVERMIND_EMBEDDING_KEY`: Your API key.
- `OVERMIND_EMBEDDING_MODEL`: The model to use (default: `qwen/qwen3-embedding-8b`).

### Configuration Automatique (.env)

Il est fortement recommandé de ne pas mettre vos mots de passe directement dans le fichier de configuration de Claude. Le serveur charge automatiquement les fichiers `.env` situés :

1. Dans le dossier racine du serveur.
2. Dans votre dossier de travail actuel.

### 🤖 Usage Serveur MCP

Configurez votre hôte (ex: Claude Desktop ou OverMind) :

```json
{
  "mcpServers": {
    "postgresql": {
      "command": "node",
      "args": ["/chemin/vers/postgresql-mcp-server/dist/index.js"]
    }
  }
}
```

> [!TIP]
> Si un fichier `.env` est présent dans `/chemin/vers/postgresql-mcp-server/`, vous n'avez pas besoin de remplir la section `env` de la configuration !

### 🗄️ Migrations

Le dossier `migrations/` contient les scripts SQL nécessaires pour préparer votre base de données (notamment pour l'extension `pgvector`). Ces scripts ne sont pas exécutés automatiquement pour éviter toute altération accidentelle de vos données.

## 📜 License

MIT
