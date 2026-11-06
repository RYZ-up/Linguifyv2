# Linguify

Jeu de traduction anglais ⇄ français qui se joue dans le navigateur. Il est en ligne sur [linguify.fr](https://linguify.fr).

- **5 niveaux** : mots seuls, puis phrases simples courtes et longues, puis phrases complexes.
- **Correction côté serveur** : le navigateur ne reçoit jamais les réponses. Une réponse exacte est reconnue tout de suite grâce à une empreinte salée. Une formulation différente est vérifiée par le serveur, avec l'avis d'une IA en option.
- **Anti-triche** : chaque réponse est figée par le serveur dès son premier envoi, et le score est recalculé côté serveur.
- **Classement de la semaine**, remis à zéro chaque lundi à 0 h (heure de Paris). Les rivaux simulés sont signalés comme tels.
- Comptes Google ou parties en invité (Firebase Auth).

## Lancer en local

```bash
npm install
npm run build:questions   # génère data/ à partir des phrases d'exemple de questions/ et questions1/
npm run dev               # http://localhost:8888
```

Le serveur de développement fait tourner la vraie API de jeu ([netlify/functions/game.mjs](netlify/functions/game.mjs)), mais avec un Firebase factice en mémoire : rien n'est enregistré.

## Tests

```bash
npm test                  # sécurité, sessions, anti-triche, classement
npm run test:browser      # partie complète dans un navigateur (Edge ou TEST_BROWSER_PATH)
npm run test:responsive   # aucun débordement de 280 à 414 px
```

## Banque de questions

Le dépôt ne contient que quelques phrases d'exemple : la banque du site n'est pas publiée, pour que les réponses restent secrètes. Pour ajouter tes propres phrases :

- `questions/levelN.txt` (anglais → français) : une ligne par phrase, au format `phrase|réponse principale|variante|…` ;
- `questions1/levelN.txt` (français → anglais) : `phrase|réponse`.

Lance ensuite `npm run build:questions`. Le niveau de chaque phrase est calculé dans [scripts/build-questions-json.js](scripts/build-questions-json.js). Le dossier `data/` est généré et reste privé : il est inclus dans les fonctions serveur, jamais dans le site public.

## Déployer (Netlify + Firebase)

1. Crée un projet Firebase avec Authentication (Google et Anonyme), Firestore et Realtime Database.
2. Mets la configuration web de ton projet dans `firebase.initializeApp({...})` de [index.html](index.html), et remplace `ton-projet-firebase` dans [scripts/build-public.cjs](scripts/build-public.cjs).
3. Déploie les règles : `firebase deploy --only firestore:rules,database --project <ton-projet>`.
4. Dans Netlify, ajoute les variables (portée « Functions ») décrites dans [.env.example](.env.example) :
   - `FIREBASE_SERVICE_ACCOUNT_JSON` (secret) ;
   - `FIREBASE_DATABASE_URL` ;
   - `ALLOWED_ORIGINS` ;
   - `GROQ_API_KEY`, facultatif, pour l'avis de l'IA.

Ne commite jamais de compte de service ni de fichier `.env` : ils sont déjà dans `.gitignore`.

## Sécurité

- Règles d'accès fermées par défaut : seul le serveur, avec Firebase Admin, écrit les scores, les sessions et les quotas.
- Débit limité par compte et par IP sur chaque action.
- En-têtes de sécurité stricts, dont une CSP sans `unsafe-inline` pour les scripts, générée avec les empreintes au build.

Pour signaler une faille, ouvre une *issue* sans détails exploitables ou contacte le mainteneur en privé.

## Licence

[MIT](LICENSE)
