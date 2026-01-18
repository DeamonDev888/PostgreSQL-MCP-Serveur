# 🚀 PostgreSQL MCP Server - CoreTools

## 📊 **Interface Unifiée - 9 Outils Core**

---

### 🔍 **Exploration & Analyse**

> **Découverte et diagnostic de l'infrastructure**

- `mcp__postgresql-server__explore` → Scanner et inventorier les bases, tables, schémas
- `mcp__postgresql-server__diagnose` → Audit complet avec métriques temps réel (connexion, performance)

---

### ⚡ **Requêtes & Données**

> **Interaction sécurisée avec les données**

- `mcp__postgresql-server__MCP_PG_VECTOR` → Exécution SQL directe avec support vectoriel (anciennement `query`)
- `mcp__postgresql-server__search` → Recherche sémantique multi-mode (auto|text|vector|hybrid)
- `mcp__postgresql-server__insert` → Insertion avec auto-vectorisation optionnelle (Qwen 8B)

---

### 🧬 **Gestion Vectorielle**

> **Opérations pg_vector optimisées**

- `mcp__postgresql-server__manage_vectors` → CRUD complet + index IVFFlat
- `mcp__postgresql-server__vectorize_row` → Générer/Réparer un embedding pour une ligne existante

---

### ⚙️ **Optimisation Performance**

> **Tuning et surveillance continue**

- `mcp__postgresql-server__optimize` → Analyse index + requêtes lentes + VACUUM

---

### ❓ **Assistance**

> **Documentation intégrée**

- `mcp__postgresql-server__help` → Guide contextuel interactif

---

## 🎯 **Architecture**

```
┌─────────────────────────────────────────────────┐
│         PostgreSQL MCP Server v1.1              │
├─────────────────────────────────────────────────┤
│  🔧 CoreTools (9) - Interface Unifiée           │
│                                                 │
│  ✅ Simplicité : Interface consolidée           │
│  ✅ Intelligence : Auto-détection modes         │
│  ✅ Cohérence : Noms de verbes standardisés     │
│  ✅ Sécurité : Validation & sandbox intégrés    │
└─────────────────────────────────────────────────┘
```

---

**🎓 Ready for Production | Optimized for LLM Agents**
