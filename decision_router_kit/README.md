# Kit meetup — Aiguillage IA (JEV + moteur open-source)

« Donner un nœud de décision à vos automatisations, sans LLM génératif. »

Ce kit montre le **même** aiguillage (état + question + options → décision typée avec
probabilités) exécuté par **deux moteurs** interchangeables : un moteur **local
open-source** (gratuit, hors-ligne) et **JEV** (TypeSafe) via **OpenRouter**.

## Contenu

| Fichier | Rôle |
|---|---|
| `jev_cloud.py` | Client JEV (TypeSafe) via OpenRouter — décision typée + probabilités. Même contrat que le moteur local. |
| `compare_local_vs_jev.py` | Démo : le même aiguillage exécuté par le moteur LOCAL (open-source, $0) ET par JEV cloud, côte à côte. |
| `demo_meetup.py` | Démo « scène » (partage d'écran) : 3 cas (accord → divergence → doute), barres de confiance, badge AUTO / REVUE HUMAINE. |
| `local_engine/router_service.py` | Micro-service de décision self-hosted (`routerd`) : lecteur de logits sur un petit Qwen3 local → $0. |

> 📥 Les **workflows n8n de triage email** (triage, tri par lot Gmail, étiquettes)
> sont dans le dossier voisin [`../email_triage_n8n/`](../email_triage_n8n/).

## Deux moteurs, un seul contrat

| | LOCAL (`routerd`) | CLOUD (JEV) |
|---|---|---|
| Coût | $0 (CPU) | ~$0,000016 / décision |
| Latence | ~2,4 s (warm), ~49 s (cold) | ~0,3–0,7 s |
| Dépendance | Qwen3-1.7B en RAM (~3,5 Go) | 1 appel HTTP |
| Offline | Oui | Non |
| C'est… | la repro open-source du pattern | le vrai produit TypeSafe |

Les deux renvoient le **même format** → on bascule de l'un à l'autre sans changer le
reste du workflow (n8n inclus).

## Endpoint JEV (OpenRouter)

```
POST https://openrouter.ai/api/alpha/decisions
Authorization: Bearer $OPENROUTER_API_KEY
Content-Type: application/json

{ "model": "typesafe/jev-1.13",
  "state": "<contexte>",
  "questions": { "queue": { "type": "choice",
                            "instructions": "Quel est le type de ce message ?",
                            "criteria": { "client urgent": "...", "spam": "..." } } } }
```

Réponse :
```json
{ "answers": { "queue": { "type": "choice", "choice": "client urgent",
                          "probabilities": {"client urgent": 1.0, "spam": 0.0},
                          "confidence": 1.0 } },
  "usage": { "input_tokens": 355, "output_tokens": 49, "cost": 0.00001491 } }
```

Types de question : `choice` (criteria = record), `noul` (criteria = {true, false}),
`score` (criteria = array de {label, description}).

## Lancer

```bash
# 1) JEV seul (aucune dépendance locale, juste une clé OpenRouter)
export OPENROUTER_API_KEY=sk-or-<votre-clé>   # ou copier .env.example → .env

python3 jev_cloud.py --state "Email: URGENT, paiement bloqué" \
  --question "Quel est le type de ce message ?" \
  --option "client urgent" --option "demande admin" --option spam --option newsletter \
  --threshold 0.6

# 2) Comparaison local vs cloud
python3 compare_local_vs_jev.py --cloud-only     # JEV seul
python3 compare_local_vs_jev.py                  # + moteur local si routerd tourne

# 3) Démo scène
python3 demo_meetup.py --cloud
```

### Moteur local (`local_engine/router_service.py`)

```bash
pip install -r local_engine/requirements.txt
python3 local_engine/router_service.py --model Qwen/Qwen3-1.7B --port 8790
# puis http://127.0.0.1:8790/decide attendu par compare/demo
```

## Au meetup

- **JEV cloud = dépense réelle** (crédits prépayés). Négligeable (100 décisions ≈ $0,002)
  mais non nulle.
- JEV n'apparaît **pas** dans `GET /api/v1/models` (modalité de sortie `decisions`, pas `text`).
- Ne pas envoyer JEV à `/chat/completions` → `POST /api/alpha/decisions` uniquement.
