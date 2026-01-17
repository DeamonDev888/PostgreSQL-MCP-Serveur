# 🛠️ Mise à jour Technique : PostgreSQL MCP Server v1.1

> **Status :** Déployé en Production 🚀
> **Modèle :** `qwen/qwen3-embedding-8b` > **Date :** 16 Janvier 2026

Ce document technique détaille les modifications apportées au code source du `serveur_PostGreSQL` pour activer l'intelligence sémantique de nouvelle génération.

## 🧠 Cœur Sémantique : Intégration Qwen3

Le moteur d'analyse a été mis à niveau pour utiliser le modèle **Qwen3 Embedding 8B** via OpenRouter.

### Pourquoi ce modèle ?

- **Précision Supérieure :** Avec **8 Milliards de paramètres**, ce modèle surpasse largement les embeddings standards (souvent < 1B).
- **Haute Résolution Vectorielle :** Passage de 1536 dimensions à **4096 dimensions**. Chaque nuance de texte est encodée avec une précision 2.6x supérieure.
- **Compréhension Multilingue :** Optimisé pour saisir les subtilités financières, même complexes.

---

## ⚙️ Modifications du Code Source

### 1. Refonte `embeddingService.ts`

- **🔌 Axios vs SDK :** Transition vers un client HTTP pur (`axios`) pour un contrôle total des headers et timeouts, critique pour les gros modèles comme Qwen.
- **🔐 Auth Flexible :** Le système accepte désormais indifféremment `OPEN_ROUTER_API_KEY` ou `OPENROUTER_API_KEY`, sécurisant le déploiement.
- **🚫 Strict Mode (No-Mock) :** Suppression totale de la méthode `generateMockEmbedding`.
  - _Avant :_ Si l'API échoue, on génère du bruit aléatoire (Dangeureux).
  - _Maintenant :_ Le système se met en **Error Safe state**. Pas de fausses données.

### 2. Gestion Dynamique des Données (Data Layer)

- **📏 Auto-Négociation des Dimensions :**
  Le code ne "devine" plus la taille des vecteurs. Au démarrage, il sonde le modèle :
  > _"Tu parles en 1536 ou 4096 ?"_ -> _"4096"_ -> _Migration de la DB._
- **🔄 Migration de Schéma à Chaud :**
  Implémentation d'une logique capable d'exécuter `ALTER TABLE enhanced_news ALTER COLUMN embedding TYPE vector(4096)` automatiquement si le modèle change.

### 3. Agent de Backfill (`src/scripts/backfill_embeddings.ts`)

Un nouvel agent autonome a été créé pour mettre à niveau l'historique :

- **Ciblage Intelligent :** Priorise les news des **7 derniers jours** (Hot Data).
- **Batch Processing :** Traitement par lots de 10 articles pour respecter les Rate Limits.
- **Resilience :** Continue le travail même si un article échoue (le loggue et passe au suivant).

## 📦 Stack Technique

| Composant          | Status      | Version / Détail                                 |
| :----------------- | :---------- | :----------------------------------------------- |
| **Client HTTP**    | ✅ Ajouté   | `axios` (Léger & Robuste)                        |
| **Env Management** | ✅ Ajouté   | `dotenv` (Chargement explicite)                  |
| **Legacy SDK**     | 🗑️ Supprimé | Dépendance OpenAI retirée du service d'embedding |
| **Database**       | 🆙 Upgradée | `pgvector` (4096 dims)                           |

## 📝 Procédure de Validation

1.  **Build System :** `npm run build` ✅
2.  **Environment :** Clé API détectée dans `.env` ✅
3.  **Runtime :**
    - Le service démarre en **Strict Mode**.
    - Toute insertion vectorielle est certifiée **Qwen 8B**.

---

_Architecte Système - Sentinel Dev Team_
