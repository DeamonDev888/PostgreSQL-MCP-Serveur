# Outils PostgreSQL MCP

## Gestion de la base de données

- `postgres_status` - Vérifie le statut de connexion à la base de données
- `test_connection` - Teste la connexion à la base de données
- `get_connection_info` - Affiche les informations détaillées de la connexion actuelle
- `list_databases` - Liste toutes les bases de données accessibles
- `list_tables` - Liste toutes les tables d'une base de données
- `describe_table` - Affiche la structure détaillée d'une table

## Exécution de requêtes

- `execute_query` - Exécute une requête SQL et retourne les résultats
- `validate_query` - Valide la syntaxe d'une requête SQL sans l'exécuter

## pgVector (vecteurs et recherche sémantique)

- `pgvector_check_extension` - Vérifie si l'extension pg_vector est installée
- `pgvector_list_tables` - Liste toutes les tables contenant des colonnes vectorielles
- `pgvector_create_column` - Ajoute une colonne vectorielle à une table existante ou crée une nouvelle table avec vecteurs
- `pgvector_create_index` - Crée un index sur une colonne vectorielle
- `pgvector_insert_vector` - Insère un vecteur dans une table
- `pgvector_batch_insert` - Insère plusieurs vecteurs en une seule requête
- `pgvector_search` - Recherche les vecteurs les plus similaires (nearest neighbors)
- `pgvector_update` - Met à jour un vecteur existant
- `pgvector_delete` - Supprime des vecteurs d'une table
- `pgvector_stats` - Affiche des statistiques sur les colonnes vectorielles

## Analyse et optimisation

- `analyze_slow_queries` - Analyse les requêtes les plus lentes
- `analyze_index_usage` - Analyse l'utilisation des index
- `analyze_table_stats` - Affiche les statistiques détaillées des tables
- `suggest_missing_indexes` - Suggère des index manquants
- `analyze_cache_performance` - Analyse les performances du cache
- `analyze_vacuum_needs` - Identifie les tables nécessitant un VACUUM/ANALYZE
- `analyze_active_locks` - Affiche les locks actifs et les requêtes en attente
- `generate_optimization_report` - Génère un rapport complet d'optimisation
