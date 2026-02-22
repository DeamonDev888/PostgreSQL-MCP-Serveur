<p align="center">
  <img src="https://readme-typing-svg.herokuapp.com?font=JetBrains+Mono&size=32&duration=6000&color=5865F2&center=true&vCenter=true&height=60&lines=%F0%9F%90%98+PostgreSQLMCP" alt="PostgreSQL MCP Server">
</p>

<p align="center">
  <img src="assets/institutional_grade_rag.jpg" alt="PostgreSQL MCP - Institutional Grade RAG" width="800">
</p>

<br>

<p align="center">
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js"></a>
  <a href="https://www.postgresql.org/"><img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL"></a>
  <a href="https://zod.dev/"><img src="https://img.shields.io/badge/Zod-F97316?style=for-the-badge&logo=zod&logoColor=white" alt="Zod"></a>
  <a href="https://discord.gg/4AR82phtBz"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
</p>

---

<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/overmind-postgres-mcp@1.0.9/assets/mcp_toolkit.png" alt="Core Tools Toolkit" width="400">
</p>

Un serveur MCP performant pour interagir avec PostgreSQL, doublé d'une bibliothèque TypeScript pour l'intelligence sémantique.

- **🧠 Mémoire Haute-Performance (4096D)** : Système RAG intégré via PostgreSQL + pgvector supportant les embeddings SOTA (Qwen 8B).
- **🛡️ Mémoire Ségréguée** : Chaque agent peut posséder ses propres souvenirs isolés tout en ayant accès au socle de connaissances global.
- **🤖 Navigation Autonome** : L'agent interagit naturellement avec la base de données via le modèle d'embedding par défaut, sans avoir besoin d'écrire des requêtes SQL complexes (sauf cas spécifique).

## 🚀 Démarrage Rapide (Usage MCP)

La façon la plus simple d'utiliser ce serveur est de le configurer comme un serveur MCP dans votre client préféré (Claude_code, Antigravity, etc.).

### 1. Configuration (.mcp.json)

```json
{
  "mcpServers": {
    "postgresql": {
      "command": "npx",
      "args": ["-y", "overmind-postgres-mcp"]
    }
  }
}
```

### 2. Variables d'Environnement (.env)

Le serveur charge automatiquement les fichiers `.env` pour sécuriser vos accès :

```env
POSTGRES_URL=postgresql://user:pass@localhost:5432/db
OPEN_ROUTER_API_KEY=sk-or-v1-...
```

---

## 📚 Usage Avancé (Bibliothèque TypeScript)

Si vous développez votre propre orchestrateur (comme le projet **[overmind-mcp](https://www.npmjs.com/package/overmind-mcp)**), vous pouvez utiliser les services directement.

### Installation

```bash
pnpm add overmind-postgres-mcp
```

### 1. Embeddings (Intelligence Sémantique)

Générez des vecteurs haute qualité compatibles avec vos tables PostgreSQL.

```typescript
import { embedText } from "overmind-postgres-mcp/services/embeddings";

const { embedding, model } = await embedText("Votre texte ici");
```

### 2. Recherche Hybride

Exploitez la puissance de la recherche hybride native.

```typescript
import { IntelligentSearchService } from "overmind-postgres-mcp/services/search";

const searchService = new IntelligentSearchService();
const results = await searchService.hybridSearch({
  query: "Comment configurer le serveur ?",
  table: "documents",
});
```

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
