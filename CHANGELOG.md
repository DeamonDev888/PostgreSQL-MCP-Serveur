# Changelog

All notable changes to `overmind-postgres-mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
