# Jev — Meetup du 8 octobre 2026

Démos du meetup **« Aiguillage IA — quand les modèles décident au lieu d'écrire »** (jeudi 8 octobre 2026, 19:00–21:00, en ligne).

Thème : les **System One models** — des modèles qui ne génèrent pas de texte mais rendent des **décisions typées** avec **probabilités calibrées** (Jev, de TypeSafe AI).

## Démos

| Démo | Description |
|---|---|
| [`jev_adblock_openrouter/`](jev_adblock_openrouter/) | Extension Chrome anti-pub : le code trouve les candidats DOM, **Jev** juge « est-ce une pub ? » et supprime l'élément. Transport via **OpenRouter** (`POST /api/alpha/decisions`, modèle `typesafe/jev-1.13`). |
| [`unclutter_openrouter/`](unclutter_openrouter/) | Extension navigateur (**unclutter**, fork WXT) : masque les pubs/promos d'une page via des règles de template réutilisables, validées par **Jev**. Build prébuildé `chrome-mv3/` fourni (load unpacked) + sources. Transport **OpenRouter**. |
| [`decision_router_kit/`](decision_router_kit/) | Kit d'aiguillage : le même nœud de décision (état + question + options → décision typée + probabilités) exécuté par un **moteur local open-source** ($0, self-hosted) et par **Jev** via OpenRouter. Clients Python + démo scène. |
| [`email_triage_n8n/`](email_triage_n8n/) | **Triage email avec Jev** (n8n) : 3 workflows Gmail — triage unitaire avec garde-fou de confiance, **tri par lot (1 appel HTTP pour N mails)**, et étiquetage temps réel. |
| [`jev_judge_n8n/`](jev_judge_n8n/) | **Jev comme LLM-judge de correctness** : au lieu d'un LLM qui juge un autre LLM, Jev rend un verdict typé + probabilités calibrées. Workflows n8n (Jev seul, Jev vs LLM-judge, éval sur golden standard) + CSV. |
| [`notebooks/`](notebooks/) | Notebooks Colab : [`jev_carwash_state_definition.ipynb`](notebooks/jev_carwash_state_definition.ipynb) — pourquoi la définition du `state` compte (type-safe ≠ world-safe). |

## Démarrage rapide

**Prérequis :** une clé **OpenRouter** (`sk-or-…`) — **BYOK**, chacun la sienne. Aucune clé n'est incluse dans ce repo.

```bash
git clone https://github.com/royam0820/Jev-Meetup.git
cd Jev-Meetup
```

Puis selon la démo :

- **Extensions (Chrome / Brave / Edge)** : `chrome://extensions` → *Developer mode* → **Load unpacked** → choisir `jev_adblock_openrouter/` (ou `unclutter_openrouter/chrome-mv3/`) → coller la clé `sk-or-…` dans la popup.
- **Kit aiguillage** : `cd decision_router_kit && cp .env.example .env` (renseigner la clé) → `python3 demo_meetup.py --cloud`. Pour la version locale : `pip install -r local_engine/requirements.txt` puis lancer `local_engine/router_service.py`.
- **Workflows n8n** : *Import from File* des `.json` → remplacer `Bearer YOUR_OPENROUTER_KEY` par une credential **Header Auth** (ou la vraie clé).
- **Notebook** : ouvrir `notebooks/jev_carwash_state_definition.ipynb` dans Colab → lancer la cellule de config → coller la clé.

## Contexte

- **Jev** sur OpenRouter : endpoint `POST https://openrouter.ai/api/alpha/decisions`, modèle `typesafe/jev-1.13`.
- Chaque démo est autonome, avec son propre README et ses instructions d'installation.

## Ressources

- TypeSafe AI : https://typesafe.ai
- Explication en 3 minutes : https://x.com/akshay_pachaar/status/2101309986156712025
