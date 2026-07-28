# Changelog

All notable changes to `overmind-postgres-mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-07-28

### Added
- **Agent-to-DB routing** via new env var `AGENT_DB_ROUTING` (JSON: `{"agent_name": "db_name"}`)
- 6 MCP tools now accept an optional `agentName` param: `diagnose`, `explore`, `MCP_PG_VECTOR` (`query`), `insert`, `manageVectors`, `vectorize_row`
- New helper `getRoutedPool(agentName, basePool)` returns a cached `pg.Pool` for the target DB or falls back to `basePool`
- Pools are cached per target DB with `max=2`, `idleTimeoutMillis=5000`

### Verified
- End-to-end: INSERT into `veridy` via `MCP_PG_VECTOR` with `agentName=veridy_scorer_avocat` (UUID `944c2203-...`)
- `current_database()` returns `veridy` (instead of `overmind_core` default) when agentName is mapped
- Backwards compatible: agents without mapping or without `agentName` use the default DB


## [1.4.2] - 2026-06-06

### Fixed
- **logger**: remove hardcoded Windows path `C:\SierraChart\ACS_Source\BTCacsil\logs\nexus-postgresql.log` that was being added unconditionally to the pino-roll file targets. The path leaked from a developer-specific debug session and was being created on every machine that installed the package, regardless of OS or environment. Default targets now only include the local `logs/nexus-postgresql.log` (under `process.cwd()`) plus any user-supplied `LOG_FILES` entries.

## [1.4.1] - 2026-05-??
### Changed
- Audit and consolidation of MCP tools into 10 core tools.
- Config: corrected `__dirname` path resolution for the dist folder (.env lookup).
- Improved .env search priority and global install support.

## [1.2.3] and earlier
See git history: `git log --oneline --decorate`.
