# Fork OpenRouter — notes

Fork de **`realZachi/typesafe-adblock`** (MIT) : on garde tout le code de l'auteur
(chercheur de candidats DOM, debounce, badge, popup), on change **uniquement le
transport** — de l'API TypeSafe directe (waitlist) vers **OpenRouter** (ta clé).

## Pourquoi c'est un « petit » fork

OpenRouter a copié le format wire de TypeSafe. Donc :

| | TypeSafe 1P | OpenRouter |
|---|---|---|
| Endpoint | `POST https://api.typesafe.ai/v1/systemone` | `POST https://openrouter.ai/api/alpha/decisions` |
| Modèle | `jev-latest` | `typesafe/jev-1.13` |
| Auth | `Authorization: Bearer <key>` | idem |
| Requête | `{model, state, questions}` | **identique** |
| Réponse | `{answers:{q:{type:"noul",noul:0.97}}}` | **identique** |
| Validation clé | `GET /v1/models` | `GET /api/v1/key` |

Résultat : `buildRequest()` et `parseResponse()` ne changent **pas**.

## Le diff exact

| Fichier | Changement |
|---|---|
| `src/typesafe.js` | endpoint + slug modèle ; `listModels` → `checkKey` (GET `/api/v1/key`) ; libellés d'erreur |
| `src/background.js` | import `checkKey` au lieu de `listModels` ; handler `testKey` |
| `src/popup.js` | affichage du statut de clé |
| `src/popup.html` | libellés « OpenRouter API key », placeholder `sk-or-…` |
| `manifest.json` | `host_permissions` → `https://openrouter.ai/*` |
| `test/live-check.mjs`, `test/relay.mjs` | `OPENROUTER_API_KEY` au lieu de `TYPESAFE_API_KEY` |
| `src/content.js` | **inchangé** (le chercheur de candidats, tout le savoir-faire) |

## Validation (live, 21/09)

`node test/live-check.mjs` sur le jeu de test de l'auteur (site de café allemand,
11 candidats, 5 pubs attendues) :

```
model: typesafe/jev-1.13-20260917 | latency 694 ms | 3743 tok in
cost $0.00015721   (11 candidats dans UNE seule requête)
11/11 correct at threshold 0.70
```

→ 100 % sur le jeu de référence, ~0,7 s, **~0,016 centime par page**.

## Installer (Chrome / Brave / Edge)

1. `chrome://extensions` → activer **Developer mode**
2. **Load unpacked** → choisir ce dossier
3. Cliquer l'icône → coller ta clé **OpenRouter** (`sk-or-…`) → **Test**
4. Naviguer : le badge compte les pubs retirées ; réglages = seuil (0.70), mode
   `Remove` / `Highlight only`, animation, toast

## Garde-fous

- ⚠️ **Démo, pas un vrai adblock** (comme l'upstream) : coûte des tokens par page,
  rate des pubs, sur-remonte parfois, ne touche pas au tracking ni aux pubs vidéo.
  Pour du sérieux : uBlock Origin.
- La clé ne part **que** vers `openrouter.ai` (aucun backend) — vérifiable dans le code.
- Ne pas committer de clé. BYOK.
