<p align="center">
  <img src="https://readme-typing-svg.herokuapp.com?font=JetBrains+Mono&size=30&duration=3000&color=5865F2&center=true&vCenter=true&multiline=true&height=50&lines=%20%F0%9F%90%A4%20PostgreSQL%20MCP%20Server%20;%E2%9C%A8%2026%20outils%20pour%20interagir%20avec%20PostgreSQL%20" alt="PostgreSQL MCP Server">
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

![Architecture](assets/image.png)

Un serveur MCP pour interagir avec PostgreSQL via Claude.

## 🚀 Démarrage Rapide

### Prérequis

- [Node.js](https://nodejs.org/) (v18 ou plus)
- [pnpm](https://pnpm.io/) (v8 ou plus)
- Une base de données PostgreSQL accessible

### Installation

```bash
# Cloner le projet
git clone https://github.com/DeamonDev888/PostgreSQL-MCP-Serveur.git
cd PostgreSQL-MCP-Serveur

# Installer les dépendances
pnpm install

# Configurer la base de données
cp .env.example .env
# Éditer .env avec vos paramètres PostgreSQL

# Compiler le projet TypeScript
pnpm build

```

## ⚙️ Configuration

### .mcp.json

```json
{
  "mcpServers": {
    "postgresql": {
      "command": "node",
      "args": ["C:\\Path\\To\\PostgreSQL\\dist\\index.js"]
    }
  }
}
```

## 🛠️ Stack

TypeScript • FastMCP • node-postgres • Zod • pnpm

## 📄 Licence

MIT
