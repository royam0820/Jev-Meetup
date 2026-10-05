# Fork OpenRouter — notes

Fork de **`kitze/unclutter`** (MIT) : on garde tout le code de l'auteur
(suppression du « clutter » de page pilotée par règles réutilisables, popup, content
script), on ajoute un **troisième transport** — OpenRouter — à côté de TypeSafe 1P
et du Gateway Vercel. Le wire format est identique, donc c'est un transport de plus,
pas une seconde implémentation.

## Le diff (commit `78eee24`)

| Fichier | Changement |
|---|---|
| `lib/providers.ts` | provider `openrouter` (+ libellés), support `OPENROUTER_API_KEY` |
| `lib/jev.ts` | `OPENROUTER_ENDPOINT` + slug modèle, pas d'en-têtes Gateway, conseils 401/403 selon provider, export `MIN_PROBABILITY` / `MIN_CONFIDENCE` |
| `entrypoints/popup/` | option « OpenRouter (Jev) », libellés neutres |
| `tests/providers.test.ts` | construction, résolution, erreurs, credentials |

> Branche `demo/impressive-filter` (`494bc4a`) : seuils `MIN_PROBABILITY` /
> `MIN_CONFIDENCE` abaissés à **0,7** pour la démo live (upstream : 0,9).

## Transport OpenRouter

| | TypeSafe 1P | OpenRouter |
|---|---|---|
| Endpoint | `POST https://api.typesafe.ai/v1/systemone` | `POST https://openrouter.ai/api/alpha/decisions` |
| Modèle | `jev-latest` | `typesafe/jev-1.13` |
| Auth | `Authorization: Bearer <key>` | idem |
| Requête / Réponse | `{state, questions}` / `{answers}` | **identique** |

## Installer (Chrome / Brave / Edge) — build prébuildé fourni

Le dossier **`chrome-mv3/`** est le build WXT déjà compilé, prêt à charger :

1. `chrome://extensions` → activer **Developer mode**
2. **Load unpacked** → choisir le dossier `unclutter_openrouter/chrome-mv3/`
3. Ouvrir la popup → choisir **OpenRouter (Jev)** → coller la clé `sk-or-…`
4. Charger `demo/fixture_fr.html` (servi en local) pour la démo

## Rebuild depuis les sources (optionnel)

Prérequis : **Bun 1.4.2** (`~/.bun/bin`).

```bash
bun install
bun run build        # → .output/chrome-mv3/
bun run check        # typecheck + lint + format + tests
```

## Garde-fous

- ⚠️ **Démo, pas un adblock** : un appel Jev par analyse (tokens consommés), publie
  sur- ou sous-filtre selon les seuils. Pour du sérieux : uBlock Origin.
- La clé ne part que vers le provider choisi (OpenRouter) — aucun backend.
