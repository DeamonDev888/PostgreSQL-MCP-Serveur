# Audit `overmind-postgres-mcp` (serveur PgVector MCP)

> Daté : 2026-04-27
> Cible : `serveur_PostGreSQL/` v**1.1.6**
> Périmètre : `package.json`, `src/index.ts`, `src/config.ts`, `src/tools/{coreTools,intelligentSearch,pgvector}.ts`, `src/services/{embeddingService,intelligentSearchService,hybridSearchService}.ts`, `src/utils/{logger,sqlValidator,dbOptimizer}.ts`, scripts, build, tests.
> Auteur : Claude Opus 4.7

---

## 1. Vue d'ensemble

### `package.json`
- **Nom** : `overmind-postgres-mcp` v**1.1.6** (dépendance directe d'`overmind-mcp` v1.5.9 — cf. audit Workflow §1).
- **Bin** : `dist/index.js` (entrée MCP via stdio).
- **Type** : ESM, `tsc -p tsconfig.build.json`.
- **Exports** publics (utilisés par Workflow comme bibliothèque) : `.`, `./config`, `./tools`, `./services/search`, `./services/embeddings`, `./utils/logger`.
- **Dépendances runtime** :
  - `fastmcp ^3.29.0` (drift mineur avec Workflow qui utilise `^3.35.0`)
  - `pg ^8.11.3`
  - `pgvector ^0.2.1` (importé mais **jamais utilisé** dans le code — cf. §6)
  - `openai ^4.20.0` (importé mais **jamais utilisé** — `embeddingService` parle directement à OpenRouter via axios)
  - `@xenova/transformers ^2.14.0` (importé mais **jamais utilisé**)
  - `axios ^1.13.2`, `dotenv ^16.3.1`, `zod ^3.22.4` (zod **v3** alors que Workflow tourne en **v4** ⚠️)
- **Engines** : non précisé (devrait l'être pour MCP/FastMCP).
- **Scripts** :
  - `build` → `tsc -p tsconfig.build.json`
  - `prebuild` → `npm run clean` (hack node CLI avec `fs.rmSync` au lieu d'utiliser `rimraf` qui est dans Workflow)
  - `test` → `node test_simple.js` (pas de framework, pas de coverage)
  - `migrate:qwen3` → `psql … migrate_to_qwen3_1024.sql` mais le fichier `migrations/` n'apparaît pas (à vérifier — cité dans `files`)
- **Sécurité publication** : aucun `prepublishOnly` → publication possible avec un `dist` désynchronisé.

### Structure
```
src/
├── index.ts            (FastMCP boot + Pool + cleanup)
├── config.ts           (Zod schema + dotenv multi-paths)
├── tools/
│   ├── coreTools.ts          ← seul ENREGISTRÉ (9 outils en réalité, pas 8)
│   ├── intelligentSearch.ts  ← 5 outils, JAMAIS chargés
│   └── pgvector.ts           ← JAMAIS chargé
├── services/
│   ├── embeddingService.ts        (singleton + cache LRU 1000)
│   ├── intelligentSearchService.ts
│   └── hybridSearchService.ts
├── utils/
│   ├── logger.ts        (file-based, writeSync, pas de rotation)
│   ├── sqlValidator.ts  ← utilitaires DÉFINIS mais peu utilisés
│   └── dbOptimizer.ts
└── scripts/backfill_embeddings.ts
```

---

## 2. Outils MCP exposés (le vrai inventaire)

### Outils **réellement enregistrés** par `index.ts` → `CoreTools.registerTools()` (9 outils, malgré le commentaire « 8 outils »)

| # | Nom MCP | Description | Statut |
|---|---|---|---|
| 1 | `diagnose` | Connexion + cache hit ratio + slow queries | ✅ |
| 2 | `explore` | databases / tables / schema / structure | ⚠️ injection (cf. §4) |
| 3 | `MCP_PG_VECTOR` | SQL direct (alias historique : `query`) | ⚠️ regex bypassable |
| 4 | `search` | Recherche intelligente (text/vector/hybrid/auto) | ⚠️ dépend `embeddingService` |
| 5 | `insert` | Insert + embedding optionnel | ⚠️ injection nom de table |
| 6 | `manage_vectors` | create/index/stats/optimize/list | ⚠️ injection nom de table |
| 7 | `optimize` | Index / queries / tables (dépend `pg_stat_statements`) | ✅ |
| 8 | `vectorize_row` | Génère embedding pour une ligne existante | ⚠️ injection |
| 9 | `help` | Aide contextuelle | ✅ |

> **Drift documentaire** : `coreTools.ts:14` et le `help()` annoncent « 8 outils », mais `registerTools()` en enregistre **9** (le 9ᵉ étant `help` lui-même). À harmoniser.

### Outils **codés mais NON enregistrés** (code mort)
| Fichier | Outils définis | État |
|---|---|---|
| `src/tools/intelligentSearch.ts` | `intelligent_search`, `search_with_mode`, `analyze_query`, `benchmark_search`, `get_search_suggestions` | 🪦 jamais instanciés depuis `index.ts` |
| `src/tools/pgvector.ts` | (à inspecter — non lu mais non référencé) | 🪦 idem |

**Impact** : ~600 lignes de TS compilées dans `dist/`, exposées dans `package.json#exports.tools`, mais inaccessibles via le serveur MCP. Si un consommateur externe (ex: `overmind-mcp`) importe `overmind-postgres-mcp/tools` en pensant accéder à ces outils, ils ne seront pas câblés au serveur.

---

## 3. Boot & cycle de vie (`src/index.ts`)

**Points forts** :
- ✅ `console.log` redirigé vers `console.error` (l.10-12) — **critique** pour stdio MCP.
- ✅ `uncaughtException` / `unhandledRejection` capturés et loggés.
- ✅ Démarrage MCP **avant** la connexion DB (l.120) → évite `EOF` côté client si la DB est lente. Très bonne pratique.
- ✅ Audit loop toutes les 5 min sur le pool (`setInterval.unref()` pour ne pas bloquer la sortie).
- ✅ Cleanup propre via SIGINT/SIGTERM.

**Faiblesses** :
- ⚠️ **B1** — Détection `isMain` (l.175-180) très permissive : `entryPath.includes(currentFilePath)` ou inversement → faux positifs possibles si le binaire est invoqué via un wrapper qui contient un sous-chemin similaire. À remplacer par une comparaison normalisée stricte.
- ⚠️ **B2** — `globalState.connectionInfo.host` parse `connectionString.split("@")[1]` (l.74-75) → casse si l'URL contient un `@` dans le mot de passe (RFC 3986 autorise `%40`).
- ⚠️ **B3** — Re-exports en bas du fichier (l.101-105) : si quelqu'un fait `import { server } from 'overmind-postgres-mcp'`, il déclenche le bootstrap (le module-level `runServer()` dans `if (isMain)`). En usage *bibliothèque*, le `server.start()` ne se déclenche pas (bonne chose), mais `getPool()` n'est PAS appelé non plus — l'utilisateur doit savoir l'invoquer. À documenter.
- ⚠️ **B4** — `setTimeout(async () => …, 100)` pour la check DB asynchrone : pas de tracking d'erreur côté `runServer`. Si la DB n'est jamais joignable, le serveur démarre quand même et le premier outil échouera mystérieusement.
- ⚠️ **B5** — `auditInterval` ne logge `WARN` qu'au-delà de 10 connexions actives, mais `dbConfig.POSTGRES_MAX_CONNECTIONS` peut être configuré différemment (défaut 10) → seuil hardcodé à 10 alors que le `max` est paramétrable. Devrait être `> max * 0.8`.

---

## 4. Sécurité — Injection SQL (priorité élevée)

`sqlValidator.ts` définit `validateIdentifier`, `validateTableName`, `validateColumnName`, `validateSchema`, `buildFullTableName`, `validateAdditionalColumns`, etc. → **ces fonctions ne sont importées NULLE PART dans `coreTools.ts`**.

### Cas concrets d'injection dans `coreTools.ts`

| Outil | Ligne | SQL généré | Vecteur d'attaque |
|---|---|---|---|
| `explore` (case `schema`) | l.200-208 | `WHERE table_name = $1` | ✅ paramétré, OK |
| `explore` (case `tables`) | l.174-182 | `WHERE table_schema = $1` | ✅ paramétré, OK |
| `MCP_PG_VECTOR` | l.350 | `SELECT * FROM (${args.sql}) AS limited_query LIMIT ${args.limit}` | ⚠️ `args.sql` passé tel quel — c'est le contrat de l'outil, mais le `args.limit` (`number` Zod) interpolé directement |
| `insert` | l.584 | `` INSERT INTO ${args.table} (${columns.join(", ")}) VALUES (...) `` | 🔥 **`table` et `columns` interpolés sans quoting** → injection possible : `args.table = "x; DROP TABLE users; --"` |
| `manage_vectors` (`create`) | l.629-635 | `` CREATE TABLE IF NOT EXISTS ${args.table} (id SERIAL …, ${args.column} vector(${args.dimensions}), …) `` | 🔥 idem |
| `manage_vectors` (`index`) | l.642-643 | `` CREATE INDEX IF NOT EXISTS ${indexName} ON ${args.table} USING ivfflat (${args.column} vector_cosine_ops) `` | 🔥 idem (3 identifiants + nom index dérivé) |
| `manage_vectors` (`stats`) | l.650-655 | `` SELECT COUNT(*), AVG(array_length(${args.column}, 1)) FROM ${args.table} WHERE ${args.column} IS NOT NULL `` | 🔥 |
| `manage_vectors` (`optimize`) | l.661 | `` VACUUM ANALYZE ${args.table} `` | 🔥 |
| `vectorize_row` | l.812, 832 | `` SELECT ${cols} as combined_text FROM ${args.table} WHERE id = $1 `` puis `` UPDATE ${args.table} SET ${args.target_column} = $1::vector …`` | 🔥 `text_columns[]` est concaténé directement dans `cols` |
| `intelligentSearchService.performVectorSearch` | l.211-217 | `` SELECT *, … FROM ${tableName} ORDER BY embedding <=> $1::vector `` | 🔥 |
| `intelligentSearchService.performRandomSearch` | l.211-217 | idem | 🔥 |
| `hybridSearchService.performHybridSearch` | l.132-143, 191-202 | `` to_tsvector('french', ${contentColumn}) FROM ${tableName} `` puis `` SELECT d.*, … FROM ${tableName} d JOIN VALUES … ON d.id = t.id `` | 🔥 |
| `hybridSearchService.performVectorSearch` | l.270-277 | idem | 🔥 |
| `hybridSearchService.textSearch` | l.307-318 | idem | 🔥 |
| `hybridSearchService.getSuggestions` | l.344-352 | `` SELECT DISTINCT ${contentColumn} FROM ${tableName} WHERE ${contentColumn} ILIKE $1 `` | 🔥 |

### Sévérité réelle
- **Contexte MCP** : ces outils sont appelés par des **agents LLM** qui sont en principe « semi-trustés ». Mais :
  - Un agent halluciné peut générer un `args.table = "x; DROP TABLE …; --"` accidentellement.
  - Si un prompt utilisateur arrive depuis un canal non-fiable (Discord, webhook, etc.) → **injection trivialement exploitable**.
- **Cas particulier `enhanced_news`** : `hybridSearchService.ts:180-181` hardcode `isUUID = (tableName === "enhanced_news")` → couplage projet-spécifique en plein dans une lib générique.

### Recommandation **SEC-1 (priorité 🔥 haute)**
Centraliser **tout** identifiant dans `validateIdentifier` (déjà disponible dans `sqlValidator.ts` !) avant interpolation :

```ts
import { validateTableName, validateColumnName } from "../utils/sqlValidator.js";
const safeTable = validateTableName(args.table);   // renvoie `"x"` (avec quotes)
const safeCol   = validateColumnName(args.column);
const sql = `SELECT * FROM ${safeTable} WHERE ${safeCol} IS NOT NULL`;
```

Effort estimé : **2-3 h** sur l'ensemble des fichiers. Risque rétrocompat : nul (les noms valides passent inchangés).

---

## 5. Sécurité — `MCP_PG_VECTOR` readonly (priorité moyenne)

### Faille
```ts
const isMutationQuery = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b/.test(queryUpper);
if (args.readonly && isMutationQuery) return "❌ bloqué";
```

**Bypass triviaux** :
1. `WITH x AS (DELETE FROM users RETURNING *) SELECT * FROM x` → commence par `WITH`, **pas détecté** par `safeKeywords` check (l.316-323), passe.
   - Attendez, regardons : `safeKeywords` inclut `WITH` → la requête est autorisée. Le check `isMutationQuery` détecte `DELETE` → bloque. **OK ici.**
2. `SELECT pg_sleep(1000)` → DoS, autorisé en readonly.
3. `COPY users TO PROGRAM 'curl …'` → exfiltration, mot-clé `COPY` non listé.
4. `SELECT lo_export(loid, '/etc/passwd')` → écriture fichier serveur si superuser.
5. Commentaires : `/* INSERT */ SELECT 1; INSERT INTO …; SELECT 2;` → multi-statements selon driver.

### Recommandation **SEC-2 (priorité moyenne)**
- Utiliser une vraie analyse syntaxique (`pg-query-emscripten` ou `pgsql-ast-parser`) plutôt qu'un regex.
- Ou imposer un **rôle PostgreSQL en lecture seule** côté DB (`SET ROLE readonly_mcp`) dans la transaction quand `readonly:true`. C'est la défense en profondeur correcte.
- Bloquer explicitement `COPY`, `LOCK`, `pg_*` fonctions sensibles, multi-statements (`;` interne).

### Bug fonctionnel **B6** : limite cassante
```ts
finalSql = `SELECT * FROM (${args.sql}) AS limited_query LIMIT ${args.limit}`;
```
Si `args.sql` se termine par un `;` ou contient un commentaire `--` final, l'enrobage casse la requête. À tester.

---

## 6. `embeddingService.ts` — Fragilité critique

### Problèmes
1. **EMB-1** — Trois noms d'env reconnus pour la même clé (l.36-39) : `OVERMIND_EMBEDDING_KEY`, `OPEN_ROUTER_API_KEY`, `OPENROUTER_API_KEY`. Source d'erreur : si l'utilisateur définit `OPENROUTER_API_KEY` dans `.env` mais que `process.env.OPEN_ROUTER_API_KEY` est défini ailleurs (ancien shell), priorité difficile à prédire.
2. **EMB-2** — Le message d'erreur en l.105 dit `Please set OPEN_ROUTER_API_KEY` mais le code accepte aussi les deux autres → l'utilisateur peut configurer `OPENROUTER_API_KEY` (l'orthographe officielle) et lire un message qui le pousse vers la mauvaise variable.
3. **EMB-3** — **Mismatch dimensions** : modèle par défaut `qwen/qwen3-embedding-8b` (4096 dims), fallback OpenAI `text-embedding-3-small` (1536 dims). Aucune logique ne corrige `dimensions: 4096` (paramètre par défaut de `generateEmbedding`) si OpenAI est utilisé → **toutes les requêtes vectorielles seront brisées** si l'utilisateur passe en fallback OpenAI sans changer la table.
4. **EMB-4** — `pgvector` (dep npm) **n'est pas utilisé** : la sérialisation se fait à la main (`` `[${embedding.join(",")}]` ``). C'est fonctionnel mais le package `pgvector` propose un encodage typé (`pgvector.toSql`) qui évite les bugs de précision flottante (notation scientifique tronquée par PostgreSQL).
5. **EMB-5** — `@xenova/transformers` listé en dep mais **jamais importé** → ~150 Mo de bin inutile dans `node_modules`.
6. **EMB-6** — `openai` listé en dep mais **jamais importé** → axios appelle directement l'endpoint `/embeddings`. À retirer.
7. **EMB-7** — `dotenv.config({ path: path.resolve(__dirname, "../../.env") })` (l.12) : chargé **deux fois** (une fois ici, une fois via `config.ts` qui scanne 5 chemins). Ordre indéterministe.
8. **EMB-8** — Cache LRU naïf : `Map.keys().next().value` est l'ordre d'insertion, donc *FIFO*, pas *LRU* réel. Si une clé chaude est insérée tôt, elle sera évincée avant les clés froides.
9. **EMB-9** — Pas de retry / backoff sur erreur API. Timeout 10 s seulement → trop court pour Qwen 8B sur prompt long (peut prendre 15-30 s).
10. **EMB-10** — Singleton exporté `export const embeddingService = new EmbeddingService();` (l.187) → instanciation **au module-load**. Si `.env` n'est pas encore chargé au moment de l'import, le service démarre en mock-mode. Avec le double `dotenv.config` (EMB-7), ça marche par chance.

---

## 7. `intelligentSearchService.ts` & `hybridSearchService.ts`

### Problèmes
1. **SRC-1** — `detectSearchMode()` (l.144) : la branche `query.startsWith("test:")` etc. retourne `"text"` mais le commentaire suggérait `random` → confusion entre intention documentée et comportement réel.
2. **SRC-2** — `performRandomSearch` (l.190-225) **est défini mais jamais appelé** depuis `search()` (le switch n'a pas de case `random`). Code mort.
3. **SRC-3** — `VECTOR_DIMENSIONS = 4096` hardcodé dans la classe. Aucune lecture depuis `embeddingService.getModelName()` ou config.
4. **SRC-4** — `vectorCache` LRU prétendu mais en réalité c'est un cache TTL (5 min) avec éviction du *plus ancien par timestamp* quand `> 100` entrées. C'est presque LRU mais le `timestamp` ne bouge pas sur read → un *Most Recently Used* peut être évincé. Renommer en `vectorCacheLRU` est trompeur.
5. **SRC-5** — `analyzeQuery()` retourne un mode mais `performRandomSearch` n'est pas exposé → la suggestion `pgvector_search avec useRandomVector: true` (l.345) parle d'un outil qui n'existe pas (référence orpheline à `pgvector.ts`, le fichier mort).
6. **SRC-6** — `hybridSearchService.performHybridSearch` (l.180-181) : `const isUUID = (tableName === "enhanced_news");` → couplage projet, déjà mentionné. Devrait inspecter `information_schema.columns.data_type` au démarrage et cacher.
7. **SRC-7** — `final_score = similarity * 0.7 + textScore * 0.3` : poids hardcodés. Pas configurable.
8. **SRC-8** — `to_tsvector('french', …)` hardcodé : si la table contient de l'anglais, qualité dégradée. Devrait être paramétrable (`language: 'french'|'english'|'simple'`).

---

## 8. `logger.ts`

### Problèmes
1. **LOG-1** — `fs.appendFileSync` à chaque log → bloquant. Sur un serveur MCP qui peut traiter des dizaines de queries/sec, c'est un goulet.
2. **LOG-2** — `console.error` final commenté (l.39). Combiné avec `index.ts:10-12` (`console.log = console.error`), les logs *applicatifs* ne sortent jamais sur stderr → seul le fichier `logs/postgresql-mcp-YYYY-MM-DD.log` les contient. Si l'utilisateur démarre via Claude Code MCP, il ne voit rien quand quelque chose foire.
3. **LOG-3** — Pas de rotation : `logs/postgresql-mcp-2026-04-27.log` grossit à l'infini sur la journée. À 10 k requêtes/jour avec stack traces, plusieurs Mo. Pas de purge des anciens fichiers.
4. **LOG-4** — `debug()` n'écrit que si `NODE_ENV === "development"` mais `dbConfig.NODE_ENV` (config.ts) défaut à `"development"` → en prod, l'utilisateur doit penser à exporter `NODE_ENV=production` sinon le fichier de log explose.

---

## 9. `config.ts`

### Problèmes
1. **CFG-1** — `searchPaths` (l.12-18) cherche notamment `../Workflow/.env` et `../../Workflow/.env` → **couplage dur** avec le projet `Workflow/`. Le serveur PostgreSQL ne devrait pas connaître le nom du projet voisin. À documenter ou retirer.
2. **CFG-2** — Si `safeParse` échoue, `dbConfig` reçoit un objet vide (POSTGRES_USER="", PASSWORD="") **et le serveur démarre quand même** (pool tentera de se connecter avec credentials vides). L'erreur est seulement loggée en `console.error`, pas levée. Préférable : **fail-fast** sauf si une variable explicite (`MCP_TOLERATE_BAD_CONFIG=1`) le permet.
3. **CFG-3** — `POSTGRES_PASSWORD: z.string().min(1)` → password vide refusé, mais le fallback (l.68) met `""` quand même. Incohérent.
4. **CFG-4** — `connectionString` peut contenir un mot de passe. Pas de masquage dans les logs (`globalState.connectionInfo.host`).

---

## 10. Tests

### État
- `test_simple.js` (~80 lignes, à inspecter) — JS pur, pas de framework, pas de mock.
- `test_complet.js` / `test_complet_robust.js` — non lancés par `pnpm test`.
- Pas de répertoire `__tests__`, pas de `vitest`, pas de `jest`.
- `test:qwen3` lance un script qui n'a pas été inspecté (mais dépend de `dist/scripts/test_qwen3_integration.js` → besoin d'un build préalable).

### Recommandations
- **TST-1** — Migrer vers `vitest` (déjà en place sur Workflow → cohérence).
- **TST-2** — Tests unitaires SQL injection : alimenter `args.table = "evil; DROP TABLE x; --"` et vérifier rejet.
- **TST-3** — Mock `pg.Pool` via `vitest` pour tester les chemins d'erreur DB.
- **TST-4** — Tests intégration optionnels avec `testcontainers` + image `pgvector/pgvector:pg16`.

---

## 11. Compatibilité avec `overmind-mcp` (parent)

| Sujet | Workflow (overmind-mcp) | serveur_PostGreSQL (overmind-postgres-mcp) | OK ? |
|---|---|---|---|
| `fastmcp` | `^3.35.0` | `^3.29.0` | ⚠️ drift mineur |
| `zod` | `^4.3.6` | `^3.22.4` | ⚠️ **majeur** (API breaking entre v3 et v4) |
| `pg` | `^8.20.0` | `^8.11.3` | OK (compat) |
| Node engines | `>=20 <25` | non précisé | À aligner |
| Logger | `console.error` direct | fichier seul (LOG-2) | Divergent |
| `.env` discovery | `loadEnvQuietly` Workflow + voisins | scan 5 chemins dont `Workflow/.env` | OK mais couplage |

### Question critique : **deux Zod en mémoire ?**
Quand `Workflow/` importe `overmind-postgres-mcp`, npm/pnpm installe les deux versions de Zod (v3 et v4). Risque : si `overmind-postgres-mcp` exporte un `ZodSchema v3` qui est consommé par du code Workflow qui attend `ZodSchema v4`, **cassure silencieuse**. À vérifier sur `pnpm why zod`.

---

## 12. Build & packaging

| Aspect | État |
|---|---|
| `tsconfig.build.json` séparé | ✅ bonne pratique |
| `prebuild` clean | ⚠️ utilise `node -e` au lieu de `rimraf` (déjà installé dans Workflow) |
| `files` whitelist | ✅ `dist`, `migrations`, `assets`, `README.md` |
| `migrations/` | ❓ **non visible** dans le ls de la racine — risque de publier un package incomplet |
| `prepublishOnly` | ❌ absent → `npm publish` peut envoyer un `dist` obsolète |
| `dist` versionné | À vérifier (.gitignore non lu) |
| Bin shebang | ✅ `#!/usr/bin/env node` en tête de `index.ts` |

---

## 13. Récap des bugs / risques (par sévérité)

### 🔥 Haute
| ID | Description | Fichier |
|---|---|---|
| **SEC-1** | Injection SQL via interpolation directe d'identifiants (table/column/colonnes texte) | `coreTools.ts`, `intelligentSearchService.ts`, `hybridSearchService.ts` |
| **SEC-2** | Bypass readonly via regex (COPY, lo_export, pg_sleep) | `coreTools.ts:283-333` |
| **EMB-3** | Mismatch dims 4096↔1536 sur fallback OpenAI | `embeddingService.ts:81` |

### ⚠️ Moyenne
| ID | Description |
|---|---|
| **CFG-2** | Démarrage serveur avec config invalide (credentials vides) |
| **B4** | Échec DB initial silencieux |
| **EMB-1/2** | Triple alias env-var, message d'erreur trompeur |
| **EMB-9** | Timeout 10 s + zéro retry sur API embedding |
| **LOG-2** | Logs invisibles sur stderr |
| **LOG-1** | `appendFileSync` bloquant |
| **TST-1..4** | Pas de tests automatisés |
| Code mort | `intelligentSearch.ts` + `pgvector.ts` exposés par `package.json#exports` mais jamais câblés |
| Drift Zod v3 vs v4 | Risque deux instances Zod en RAM |

### 💡 Basse / qualité
| ID | Description |
|---|---|
| **EMB-5/6** | `@xenova/transformers` et `openai` en deps inutilisées |
| **B1, B2, B3, B5** | Détections fragiles (isMain, host parse, pool seuil) |
| **SRC-1..8** | Modes/heuristiques figés, code mort `performRandomSearch` |
| **LOG-3** | Pas de rotation logs |
| **CFG-1** | Couplage `Workflow/.env` dans le scan |
| Drift documentaire | « 8 outils » alors qu'il y en a 9 |
| `prepublishOnly` absent | Risque de publier `dist` obsolète |

---

## 14. Recommandations prioritaires (ordre d'application suggéré)

1. **SEC-1** : envelopper tous les identifiants par `validateIdentifier` — déjà disponible dans `sqlValidator.ts`. Correctif chirurgical, ~2 h.
2. **SEC-2** : créer un rôle PostgreSQL `mcp_readonly` et `SET ROLE` dans une transaction quand `readonly:true`. Plus sûr qu'un regex.
3. **EMB-3** : dériver `dimensions` du modèle (`qwen3-embedding-8b → 4096`, `text-embedding-3-small → 1536`) plutôt que de l'imposer par défaut.
4. **CFG-2** : `process.exit(1)` si `safeParse` échoue, sauf en mode test (`NODE_ENV=test`).
5. **LOG-1** + **LOG-2** : log async (`fs.createWriteStream` + `.write`) **et** mirroring stderr en dev.
6. **Outils morts** : soit câbler `IntelligentSearchTools.registerTools()` dans `index.ts` (5 outils en plus), soit retirer le fichier + l'export `./tools/intelligentSearch` de `package.json`. Ne pas laisser les deux.
7. **Drift Zod** : aligner sur `zod ^4.x` (le parent est en v4).
8. **Tests** : introduire vitest minimal (`safe identifier`, `readonly bypass`, `pool init`).
9. **`prepublishOnly`** : `"prepublishOnly": "npm run build"`.
10. **Drift `fastmcp`** : aligner sur `^3.35.0` pour matcher Workflow.

---

## 15. Synthèse

| Bloc | État |
|---|---|
| Architecture (FastMCP + Pool + cleanup) | ✅ propre |
| Boot stdio MCP-compatible | ✅ |
| Outils enregistrés | ⚠️ 9 OK mais 5+ outils en code mort exposés via `exports` |
| Sécurité SQL (identifiants) | 🔥 injection triviale via `args.table` / `args.column` |
| Sécurité readonly | ⚠️ regex bypassable |
| Embedding service | ⚠️ deps inutilisées + dimensions hardcodées + cache mal nommé |
| Search services | ⚠️ couplage projet (`enhanced_news`) + code mort |
| Logger | ⚠️ sync + pas de rotation + pas de stderr |
| Config | ⚠️ tolère config invalide |
| Tests | ❌ inexistants côté framework |
| Compat avec Workflow | ⚠️ drift Zod v3↔v4 et fastmcp 3.29↔3.35 |
| Build & packaging | ⚠️ pas de `prepublishOnly`, `migrations/` douteux |

**Verdict** : le serveur **fonctionne** et son architecture (FastMCP, Pool, cleanup) est saine. Mais **trois familles de problèmes** demandent une intervention :
1. **Sécurité** : injection SQL via identifiants + bypass readonly → indispensable avant tout usage exposé à des prompts non-fiables.
2. **Cohérence** : 5+ outils exposés via `package.json` sans être câblés au serveur → vrai piège pour les consommateurs.
3. **Compat parent** : Zod v3 dans une chaîne où Workflow tourne en v4 → bombe à retardement type-safety.

Les correctifs SEC-1, SEC-2 et le câblage/cleanup des outils morts représentent ~1 journée de travail et neutralisent l'essentiel des risques opérationnels.

---

*Audit purement documentaire. Aucun fichier source n'a été modifié.*
