# PostgreSQL-MCP Documentation Site

Site de documentation pour le serveur MCP PostgreSQL avec RAG 4096D.

## 🚀 Structure

```
docs/
├── index.html      # Page principale
├── styles.css      # Styles cyberpunk/thème PostgreSQL
├── script.js       # Animations et interactions
└── README.md       # Ce fichier
```

## 🎨 Caractéristiques

- **Design Cyberpunk** : Effets matrix, orbes lumineux, animations fluides
- **Thème PostgreSQL** : Couleurs inspirées de PostgreSQL (bleu, vert, cyan)
- **Responsive** : Adapté mobile, tablette et desktop
- **Interactif** :
  - Effet de parallaxe
  - Cartes 3D au survol
  - Animation des statistiques
  - Copie en un clic
  - Navigation par onglets

## 📦 Fonctionnalités Affichées

- Mémoire 4096D avec pgvector
- Recherche hybride (vectorielle + full-text)
- Auto-embedding avec Qwen 8B
- API Type-Safe TypeScript
- Configuration MCP Zero-Config

## 🛠️ Personnalisation

### Couleurs

Les couleurs sont définies dans `styles.css` :

```css
:root {
  --neon-pink: #ff006e;
  --neon-cyan: #00fff5;
  --neon-purple: #b537f2;
  --neon-blue: #3b82f6;
  --neon-green: #00ff88;
  --gradient-postgres: linear-gradient(135deg, #336791, #00ff88, #00fff5);
}
```

### Contenu

Le contenu principal est dans `index.html`. Les sections importantes :

- Hero section avec statistiques
- Grille de fonctionnalités
- Onglets d'installation
- Exemples de code
- Structure du projet

## 🚀 Déploiement

### GitHub Pages

1. Push le dossier `docs` dans la branche `gh-pages`
2. Activer GitHub Pages dans les settings du repo
3. Le site sera accessible à `https://username.github.io/repo-name/`

### Vercel/Netlify

1. Connecter le repo
2. Définir le répertoire de publication sur `docs`
3. Deploy

## 📱 Aperçu

Ouvrez `index.html` directement dans votre navigateur pour un aperçu local.

## 🎯 Sections

1. **Hero** : Présentation avec statistiques animées
2. **Features** : 6 cartes détaillant les fonctionnalités
3. **Installation** : 3 onglets (MCP, Bibliothèque, Local)
4. **Bibliothèque** : Exemple d'utilisation TypeScript
5. **Structure** : Organisation du projet
6. **Exemples** : 3 cas d'usage concrets
7. **Footer** : Liens sociaux (GitHub, Discord, NPM)

## 🎨 Effets Visuels

- **Matrix Rain** : Animation de caractères en arrière-plan
- **Orbes Flottantes** : 3 orbes avec animation flottante
- **Grid Perspective** : Grille 3D en perspective
- **Glitch Effect** : Effet glitch sur le titre
- **Cartes 3D** : Rotation 3D au survol de la souris
- **Particules** : Explosion de particules au clic sur le cerveau

## 📊 Statistiques Animées

Les statistiques dans la hero section s'animent au scroll :

- 4096 Dimensions Mémoire
- 100% Type-Safe
- 8 Modèles Supportés

## 🔧 Technologies

- HTML5
- CSS3 (Grid, Flexbox, Animations)
- JavaScript Vanilla (ES6+)
- Font Awesome 6.5.1

## 📝 Licence

MIT

<!-- Last Deploy: 2026-02-22T14:35:00 -->
