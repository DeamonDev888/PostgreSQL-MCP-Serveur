<p align="center">
  <img src="https://readme-typing-svg.herokuapp.com?font=JetBrains+Mono&size=32&duration=6000&color=5865F2&center=true&vCenter=true&height=60&lines=%F0%9F%90%98+PostgreSQLMCP" alt="PostgreSQL MCP Server">
</p>

<br>

<p align="center">
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js"></a>
  <a href="https://www.postgresql.org/"><img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL"></a>
  <a href="https://zod.dev/"><img src="https://img.shields.io/badge/Zod-F97316?style=for-the-badge&logo=zod&logoColor=white" alt="Zod"></a>
  <a href="#"><img src="https://img.shields.io/badge/FastMCP-000000?style=for-the-badge&logoColor=white" alt="FastMCP"></a>
</p>

---

<p align="center">
  <img src="assets/mcp_toolkit.png" alt="Core Tools Toolkit" width="400">
</p>

Un serveur MCP performant pour interagir avec PostgreSQL, doublé d'une bibliothèque TypeScript pour l'intelligence sémantique.

## 🚀 Démarrage Rapide

### Installation (NPM)

```bash
pnpm add postgresql-mcp-server
```

### Installation (Source)

```bash
# Cloner le projet
git clone https://github.com/DeamonDev888/PostgreSQL-MCP-Serveur.git
cd PostgreSQL-MCP-Serveur

# Installer les dépendances
pnpm install

# Compiler le projet
pnpm build
```

## 🧠 Intelligence Sémantique (Hybrid Search)

Le serveur supporte nativement **pgvector** et les embeddings (ex: **Qwen3 8B**) via OpenRouter ou OpenAI.

### 🛠️ Usage en tant que Bibliothèque

```typescript
import { embedText } from "postgresql-mcp-server/services/embeddings";

const { embedding, model } = await embedText("Votre texte ici");
```

---

## ⚙️ Configuration & Sécurité

### Zero-Config (.env)

Il est recommandé d'utiliser un fichier `.env` pour éviter d'exposer vos secrets dans les fichiers de configuration des hôtes (ex: Claude Desktop). Le serveur charge automatiquement les fichiers `.env` à sa racine ou dans le dossier d'exécution.

```env
POSTGRES_HOST=localhost
POSTGRES_USER=postgres
POSTGRES_PASSWORD=votre_mot_de_passe
POSTGRES_DATABASE=votre_db
OPEN_ROUTER_API_KEY=sk-or-v1-...
```

### Configuration Serveur MCP (.mcp.json)

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

---

## 💡 Exemples d'Usage (Agent)

### 1. Préparer une table pour Qwen (4096 dimensions)

```typescript
use_tool("manage_vectors", {
  action: "create",
  table: "knowledge_base",
  dimensions: 4096,
});
```

### 2. Insertion avec Auto-Embedding

```typescript
use_tool("insert", {
  table: "knowledge_base",
  data: { content: "Guide d'installation..." },
  generateEmbedding: true,
});
```

### 3. Recherche Hybride (RAG)

```typescript
use_tool("search", {
  query: "Comment installer ?",
  table: "knowledge_base",
  mode: "hybrid",
});
```

---

## 🗄️ Migrations

Le dossier `migrations/` contient les scripts SQL nécessaires pour configurer l'extension `pgvector` et optimiser vos tables pour les recherches haute performance.

---

## 📄 Licence

MIT
