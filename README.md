# endBuy

Application de communication complète (serveurs, salons, messages, appels vocaux / vidéo, partage d'écran)
avec **endBuy Nitro Lifetime offert automatiquement à chaque compte**, et une inscription **sans e-mail ni téléphone**.

- Frontend : React 19 + TypeScript + Tailwind CSS 4 (Vite)
- Backend : Node.js + Express 5 + WebSocket (`ws`) + WebRTC (signalisation)
- Base de données : PostgreSQL (`DATABASE_URL`) — ou PostgreSQL embarqué (PGlite) si aucune URL n'est fournie
- Bureau : Electron 45 → `endBuy-Setup.exe` (installateur) et `endBuy.exe` (portable)

---

## 1. Architecture

```
client/   Interface web (React). Compilée dans client/dist et servie par le serveur.
server/   API REST /api, passerelle temps réel /ws, fichiers /uploads, interface web.
desktop/  Application Windows (Electron) : fenêtre dédiée + serveur endBuy embarqué.
deploy/   Caddyfile (HTTPS automatique) pour la production.
```

| Domaine | Implémentation |
|---|---|
| Comptes | Pseudonyme + mot de passe (scrypt), identifiant unique « snowflake », avatar prédéfini ou importé |
| Sessions | Jeton aléatoire 256 bits en cookie `httpOnly`/`SameSite=Lax` (`Secure` en HTTPS), stocké haché (SHA-256), liste des appareils + révocation |
| Anti-abus | Limitation de débit (connexion, inscription, récupération, messages, réactions), verrouillage du compte après 8 échecs, en-tête anti-CSRF, Helmet/CSP, contrôle d'origine du WebSocket |
| Récupération | 10 codes à usage unique (hachés) donnés à l'inscription, régénérables |
| 2FA | TOTP facultatif (QR code, anti-rejeu), codes de récupération acceptés |
| Nitro Lifetime | Table `subscriptions` écrite **uniquement par le serveur** à l'inscription (et rattrapée au démarrage). Toutes les limites premium sont appliquées côté serveur : impossible à falsifier depuis le navigateur |
| Serveurs | Création / suppression / transfert, icône, invitations (expiration, nombre d'utilisations), catégories, salons textuels / vocaux, salons privés |
| Permissions | 22 permissions en bitfield, rôles hiérarchisés (Administrateur / Modérateur créés par défaut), permissions par salon (rôle ou membre), héritage de catégorie, expulsion / bannissement |
| Messagerie | Temps réel, MP, groupes (10 max), réponses, réactions (emojis Unicode et personnalisés), modification, suppression, épingles, images / vidéos / fichiers (500 Mo avec Nitro), aperçus de liens (protégés contre le SSRF), indicateur de saisie, mentions, non-lus, recherche, Markdown |
| Présence | En ligne, absent (auto après 10 min), ne pas déranger, invisible, statut personnalisé |
| Voix / vidéo | WebRTC maillé : salons vocaux, appels privés (sonnerie), micro, sourdine, caméra, partage d'écran (+ son sous Windows), volume par personne, détection de parole, modération (mute serveur / déconnexion) |
| Événements | Événements programmés (conférence, salon vocal ou lieu externe), « Ça m'intéresse », lancement / fin, rappel automatique, bannière « EN DIRECT » |
| Conférences | Salons de conférence : orateurs sur scène, public, main levée, invitation à parler, modération ; seuls les orateurs émettent (passe à l'échelle) |
| Effets de mouvement | Halo qui suit la souris, cartes inclinables en 3D, boutons aimantés, parallaxe — désactivables (*Apparence*) |
| Personnalisation | Thèmes sombre / clair / minuit + 5 thèmes Nitro en dégradé, couleur d'accent, taille du texte, bannière, thème de profil, bio, pronoms, emojis & stickers de serveur |
| Langues | Français (par défaut) et anglais |

## 2. Lancer en développement

Prérequis : Node.js 20+ (testé avec Node 24).

```bash
npm run install:all
```

```bash
npm run dev:server
```

Dans un second terminal :

```bash
npm run dev:client
```

Ouvre http://localhost:5173. Sans `DATABASE_URL`, les données sont stockées dans `server/data/` (PostgreSQL embarqué).

## 3. Lancer en production (une seule commande Node)

```bash
npm run build
```

```bash
DATABASE_URL=postgres://user:motdepasse@hote:5432/endbuy TRUST_PROXY=true npm start
```

Variables d'environnement du serveur :

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` / `HOST` | Écoute HTTP | `3001` / `0.0.0.0` |
| `DATABASE_URL` | PostgreSQL de production (sinon PGlite embarqué) | — |
| `DATA_DIR` | Fichiers téléversés (et base embarquée) | `server/data` |
| `TRUST_PROXY` | `true` derrière Caddy / Nginx (cookies `Secure`) | `false` |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | Relais TURN pour les appels | STUN public seulement |
| `ICE_SERVERS` | Liste ICE complète au format JSON (remplace la précédente) | — |
| `REGISTRATION_OPEN` | `false` pour fermer les inscriptions | `true` |
| `ALLOWED_ORIGINS` | Origines supplémentaires autorisées pour le WebSocket | `http://localhost:5173` |
| `UPLOAD_STORAGE` | `database` pour stocker les fichiers dans PostgreSQL (hébergeurs sans disque permanent) | `disk` |
| `MAX_UPLOAD_MB` | Plafond de taille des fichiers imposé par l'hébergeur | aucun (500 Mo avec Nitro) |

## 4. Mettre endBuy en ligne gratuitement (comme Discord : tout le monde se connecte au même endroit)

Une seule personne héberge le serveur (une fois) ; ensuite chacun lance l'application et parle avec tout le monde.

1. **Base de données** — crée un compte gratuit sur [neon.tech](https://neon.tech), crée un projet `endbuy`, copie
   l'URL de connexion (`postgresql://…?sslmode=require`).
2. **Code** — mets ce dossier dans un dépôt GitHub (privé, c'est possible).
3. **Serveur** — sur [render.com](https://render.com) : *New → Blueprint*, choisis le dépôt. Render lit `render.yaml`
   et demande `DATABASE_URL` : colle l'URL Neon. Au bout de quelques minutes, ton serveur est en ligne
   (`https://endbuy-xxxx.onrender.com`). Le site web fonctionne déjà à cette adresse.
4. **Application Windows** — génère l'exe déjà relié à ton serveur :

```bash
ENDBUY_SERVER_URL=https://endbuy-xxxx.onrender.com npm run desktop:dist
```

Limites de l'offre gratuite de Render : le serveur s'endort après 15 min sans visite et met ~1 min à se réveiller
(l'application affiche « Réveil du serveur endBuy… ») ; les fichiers envoyés sont limités à 25 Mo et stockés dans la
base Neon (0,5 Go gratuits). Pour lever ces limites : une offre payante Render ou le déploiement Docker ci-dessous.

## 4 bis. Déployer sur son propre serveur (Docker)

Sur un VPS Linux avec Docker et un nom de domaine pointant vers lui :

```bash
cp .env.example .env
```

Remplis `.env` (domaine, mots de passe), puis :

```bash
docker compose up -d --build
```

Cela lance PostgreSQL, endBuy, **Caddy** (HTTPS Let's Encrypt automatique — obligatoire pour le micro et la caméra
dans les navigateurs) et **coturn** (relais TURN pour que les appels passent derrière les box et réseaux d'entreprise).
Ouvre les ports 80, 443, 3478 (TCP+UDP) et 49160-49200 (UDP).

## 5. Application Windows (.exe)

### Ce qui a été produit

`desktop/release/endBuy-Setup.exe` (installateur) et `desktop/release/endBuy.exe` (version portable, sans installation).

- Fenêtre dédiée avec barre de titre personnalisée, icône endBuy, écran de démarrage, zone de notification
- Lancement automatique à la fin de l'installation, raccourcis Bureau et menu Démarrer, dossier d'installation au choix
- Toutes les fonctionnalités : connexion, serveurs, messages, Nitro Lifetime, voix, vidéo, partage d'écran (sélecteur d'écran / fenêtre intégré)
- **Serveur intégré** : sans configuration, l'application démarre son propre serveur endBuy (avec PostgreSQL embarqué) ;
  dans *Paramètres → Serveur endBuy* on peut **partager ce serveur sur le réseau local** ou **se connecter à un serveur hébergé**

### Connecter l'exe à ton serveur hébergé (pour que tout le monde se parle)

Deux possibilités :
1. Dans l'application : *Paramètres → Serveur endBuy → Se connecter à un serveur hébergé* → `https://ton-domaine`.
2. Générer un exe déjà configuré :

```bash
ENDBUY_SERVER_URL=https://endbuy.example.com npm run desktop:dist
```

### Recompiler l'exe

```bash
npm run install:all
```

```bash
npm run desktop:icons
```

```bash
npm run desktop:dist
```

Les fichiers sont générés dans `desktop/release/`. L'exe n'est pas signé numériquement : Windows SmartScreen affichera
« Windows a protégé votre ordinateur » → *Informations complémentaires* → *Exécuter quand même*. Pour supprimer cet
avertissement, il faut un certificat de signature de code (`CSC_LINK` / `CSC_KEY_PASSWORD` pour electron-builder).

## 6. Tests

```bash
npm test
```

27 tests d'intégration (vrai serveur, vraie base) : inscription sans e-mail, Nitro attribué et infalsifiable, CSRF,
connexion / limitation, serveurs, invitations, rôles, salons privés, hiérarchie, expulsion / bannissement, messages temps
réel, saisie, réponses, réactions, modification, épingles, recherche, fichiers (et blocage du HTML), amis, MP, groupes,
blocage, signalisation WebRTC, sonnerie d'appel, événements (création, intérêt, lancement, fin), conférences (main levée,
orateurs), 2FA TOTP, récupération de compte. `TEST_UPLOAD_STORAGE=database npm test` vérifie le stockage en base.
Pour les lancer contre un vrai PostgreSQL : `TEST_DATABASE_URL=postgres://… npm test`.

## 7. Limites connues

- **Voix / vidéo en maillage (mesh)** : chaque participant envoie son flux à tous les autres. Idéal jusqu'à ~8 personnes par
  salon vocal. Dans une conférence, seuls les orateurs émettent, ce qui permet un public bien plus large (chaque orateur
  envoie toutefois un flux par auditeur ; pour des centaines d'auditeurs, il faudrait un SFU comme LiveKit).
- Sans relais **TURN**, certains réseaux (NAT symétriques, réseaux d'entreprise) bloquent les appels : le `docker-compose.yml` en fournit un.
- Dans un navigateur, micro / caméra exigent **HTTPS** (ou `localhost`). L'application de bureau, elle, les autorise aussi sur un serveur du réseau local en HTTP.
- Le son du partage d'écran n'est disponible que sous Windows (application de bureau).
- La version portable `endBuy.exe` décompresse ses fichiers à chaque lancement : le démarrage est plus lent que la version installée.
