# 🚀 Rapport d'Intégration : Intelligence Sémantique Qwen & Sentinel V3.5

Ce document résume les mises à jour majeures effectuées pour doter Sentinel d'une véritable compréhension sémantique des marchés et optimiser ses cycles d'exécution.

## 1. 🧠 Moteur d'Embedding (OpenRouter / Qwen)

L'ancien système "Mock" (génération aléatoire) a été **supprimé** et remplacé par une intégration stricte de l'API OpenRouter.

- **Modèle activé :** `qwen/qwen3-embedding-8b`
- **Technologie :** Appel API direct via `axios` avec gestion robuste des erreurs ("Fail Loudly").
- **Sécurité :** Support des clés API `OPEN_ROUTER_API_KEY` et `OPENROUTER_API_KEY`.
- **Strict Mode :** Si l'API est injoignable ou la clé manquante, le système se met en erreur critique plutôt que d'inventer des fausses données.

## 2. 🧬 Mutation de la Base de Données

Qwen étant un modèle "Large Level", il génère des vecteurs de haute précision (4096 dimensions) contre 1536 pour les standards OpenAI classiques.

- **Migration Automatique :** Le système a détecté la différence et a exécuté :
  ```sql
  ALTER TABLE enhanced_news ALTER COLUMN embedding TYPE vector(4096);
  ```
- **Backfill Historique :** Un agent (`backfill_embeddings.ts`) a été déployé pour recalculer les vecteurs de l'historique des news, en priorisant les 7 derniers jours.
- **Statut :** La base de données est maintenant "Next-Gen Ready".

## 💾 État Actuel

- ✅ **Serveur PostgreSQL :** Connecté & Compatible Vector 4096.

---

- 2026-01-16\_
