# QR Sentinel — analyseur de QR codes piégés (quishing)

Les arnaques par QR code se multiplient : fausses amendes sur le pare-brise,
autocollants collés sur les parcmètres, faux menus, faux e-mails de banque…
**QR Sentinel** lit le QR code **sans l'ouvrir**, suit toutes les redirections,
vérifie l'âge et la réputation du site, puis donne un verdict simple :
**sûr**, **suspect** ou **dangereux**, avec les raisons.

- Interface : `https://yanisdardaz.github.io/portfolio/quishing/`
- Code : ce dossier (`quishing/`)

## Fonctionnement

```
 Photo / caméra / texte
          │  décodage du QR code dans le navigateur (jsQR) : rien n'est ouvert
          ▼
   Contenu du QR code ──► type : lien, Wi-Fi, SMS, appel, e-mail, crypto, texte…
          │
          ▼  (mode complet : envoyé au serveur d'analyse)
 ┌───────────────────────────────────────────────────────────────┐
 │ 1. Suivi des redirections : 3xx, <meta refresh>, location=… │
 │    (le JavaScript n'est jamais exécuté, protection SSRF)       │
 │ 2. Âge du domaine final via RDAP (successeur du WHOIS)        │
 │ 3. Réputation : OpenPhish, URLhaus, Google Safe Browsing       │
 │ 4. Règles : usurpation de marque, faux .gouv, homoglyphes,     │
 │    adresse IP, « @ » trompeur, extension douteuse, APK…        │
 └───────────────────────────────────────────────────────────────┘
          ▼
   Score de risque 0–100 → sûr (< 25) · suspect (25–59) · dangereux (≥ 60)
```

### Ce qui est détecté

| Signal | Exemple |
| --- | --- |
| Usurpation d'une marque ou d'un service public | `amendes-gouv-paiement.com`, `paypal.com.compte-verif.net` |
| Faux site du gouvernement | `service-gouv-fr.online` (les vrais finissent par `.gouv.fr`) |
| Homoglyphes / punycode | `pаypal.com` écrit avec un « а » cyrillique |
| « @ » trompeur | `https://www.laposte.fr@colis-suivi.top/` |
| Adresse IP au lieu d'un domaine | `http://185.23.44.10/ameli` |
| Lien raccourci | `bit.ly`, `tinyurl.com`, `qrco.de`… (résolu en mode complet) |
| Hébergeur gratuit | `*.netlify.app`, `*.github.io`, `*.pages.dev`… |
| Domaine très récent | créé il y a moins de 30 jours |
| Redirections nombreuses, cachées ou vers un autre site | `<meta http-equiv="refresh">`, `location.href = …` |
| Certificat HTTPS invalide | expiré, auto-signé, émis pour un autre site |
| Téléchargement direct | `.apk`, `.exe`, `Content-Disposition: attachment` |
| Formulaire de mot de passe sur un site récent | page de phishing classique |
| Listes noires | OpenPhish, URLhaus, Google Safe Browsing |
| QR codes non-web | SMS vers numéro court, appel surtaxé (`0899`), paiement crypto, Wi-Fi ouvert, `javascript:` |

Toutes les règles, pondérations et messages sont dans [`data/rules.json`](data/rules.json).

## Deux modes

| | Analyse locale (GitHub Pages seul) | Analyse complète (avec le serveur) |
| --- | --- | --- |
| Décodage du QR code | ✅ dans le navigateur | ✅ dans le navigateur |
| Règles (marques, punycode, IP…) | ✅ | ✅ |
| Âge du domaine | ✅ depuis le navigateur (rdap.org) | ✅ |
| Suivi des redirections | ❌ impossible depuis un navigateur | ✅ |
| Listes noires | ❌ | ✅ |

Le badge en haut à droite indique le mode actif. Le suivi des redirections
nécessite un serveur, car un navigateur ne peut pas lire les redirections d'un
autre site (et ne doit surtout pas ouvrir le lien).

## Mettre le serveur en ligne (gratuit)

Le serveur est en Python **sans aucune dépendance**. Il sert aussi l'interface :
une fois déployé, son adresse donne directement le site en mode complet.

**Render (recommandé)** — le fichier [`render.yaml`](../render.yaml) est prêt :

1. Crée un compte sur [render.com](https://render.com) avec ton compte GitHub.
2. *New* → *Blueprint* → choisis le dépôt `portfolio` → *Apply*.
3. Copie l'adresse obtenue (par ex. `https://qr-sentinel.onrender.com`) dans
   [`js/config.js`](js/config.js) (`apiUrl`), pour activer le mode complet
   sur GitHub Pages aussi.

**Docker (n'importe quel hébergeur)** :

```bash
docker build -t qr-sentinel quishing
```

```bash
docker run -p 8000:8000 qr-sentinel
```

**Sans Docker** :

```bash
cd quishing/backend && python3 -m quishing.server
```

Puis ouvre <http://localhost:8000>.

### Variables d'environnement

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `PORT` | port d'écoute | `8000` |
| `ALLOWED_ORIGINS` | origines autorisées (CORS), séparées par des virgules | `*` |
| `RATE_LIMIT_PER_MIN` | analyses par minute et par IP | `20` |
| `TRUST_PROXY` | `1` derrière un proxy (Render, Fly…) | `0` |
| `GSB_API_KEY` | clé [Google Safe Browsing](https://developers.google.com/safe-browsing/v4/get-started) (gratuite) | — |
| `URLHAUS_AUTH_KEY` | clé [URLhaus](https://auth.abuse.ch/) (gratuite) | — |
| `OPENPHISH` | `0` pour désactiver le flux OpenPhish | `1` |

### API

```bash
curl -X POST https://<serveur>/api/analyze -H 'Content-Type: application/json' -d '{"payload": "https://bit.ly/xxxx"}'
```

Réponse : `verdict`, `score`, `reasons[]` (id, points, message), `payload` (type
détecté), `target`, et `network` (redirections, domaine RDAP, réputation).

## Sécurité du serveur

Un service qui visite des liens à la place de l'utilisateur est une cible
classique d'attaque SSRF. Protections en place :

- chaque domaine est résolu, **toutes** ses adresses doivent être publiques
  (refus de `127.0.0.1`, `10.0.0.0/8`, `169.254.169.254`, IPv6 locales,
  IPv4 mappées…), puis la connexion se fait vers l'IP vérifiée (pas de
  seconde résolution DNS exploitable) ;
- 10 redirections maximum, détection des boucles, délai total limité ;
- seuls les 256 premiers Ko des pages HTML sont lus, jamais exécutés ;
- limitation du débit par IP, taille des requêtes bornée ;
- le serveur de fichiers refuse tout chemin hors de l'interface (`../`) ;
- aucun contenu analysé n'est enregistré dans les journaux.

## Tests

```bash
pip install pytest && python -m pytest -q quishing/backend/tests
```

```bash
node --test quishing/tests/js/*.test.js
```

```bash
cd quishing && npm install --no-save playwright && npx playwright install chromium && node tests/e2e/run.js
```

- **104 tests Python** : moteur de règles, suivi des redirections contre un faux
  site piégé local (3xx, meta refresh, JavaScript, boucles, APK…), certificats
  TLS auto-signés, protection SSRF, RDAP, réputation, API HTTP (erreurs, CORS,
  limitation de débit, accès aux fichiers).
- **51 tests JavaScript** du moteur, avec les **mêmes cas** que Python
  ([`tests/cases.json`](tests/cases.json)) + un test de **parité** qui vérifie
  que les deux moteurs donnent exactement le même résultat.
- **13 tests de bout en bout** dans Chromium : image, caméra (vidéo simulée),
  texte, exemples, mode complet et mode local, mobile.

Ils tournent automatiquement sur GitHub Actions à chaque modification
([`.github/workflows/quishing-tests.yml`](../.github/workflows/quishing-tests.yml)).

## Limites

- Les sites de phishing changent vite : un verdict « sûr » n'est pas une
  garantie absolue.
- Certains sites malveillants affichent une page normale aux robots
  (« cloaking ») ; le serveur se présente comme un iPhone pour limiter ce biais.
- Le domaine enregistrable est calculé avec une liste réduite de suffixes
  (`co.uk`, `gouv.fr`…), pas avec la Public Suffix List complète.
- En mode local, le nom de domaine (pas le lien complet) est envoyé à
  rdap.org pour connaître son âge.

## Crédits

Décodage des QR codes : [jsQR](https://github.com/cozmo/jsQR) (licence Apache 2.0,
`vendor/jsQR-LICENSE.txt`).
