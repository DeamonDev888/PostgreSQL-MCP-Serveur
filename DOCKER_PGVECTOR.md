# Test de connexion au Docker pgvector

## Configuration MCP (déjà correcte)

```env
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DATABASE=financial_analyst
POSTGRES_USER=postgres
POSTGRES_PASSWORD=9022
```

## Vérification Docker

```bash
# Vérifier que Docker pgvector tourne
docker ps | findstr postgres-pgvector

# Vérifier l'extension pg_vector
docker exec -it postgres-pgvector psql -U postgres -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"
```

## Test connexion MCP

```bash
cd "C:\Users\Deamon\Desktop\Backup\Serveur MCP\serveur_PostGreSQL"
npm run dev
```

Dans Claude Desktop, testez :
- `postgres_status` - Doit afficher PostgreSQL 16.11 (Debian)
- `pgvector_check_extension` - Doit afficher pg_vector installé
- `pgvector_list_tables` - Doit lister les tables avec colonnes vectorielles

## Résultat attendu

```
✅ Connecté à PostgreSQL
Base: financial_analyst
Version: 16.11 (Debian)  ← Notez "Debian" = Docker
```

Si vous voyez "Debian" dans la version, c'est que vous êtes sur le Docker ! ✅
