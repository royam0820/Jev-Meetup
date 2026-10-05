# Triage email avec Jev (n8n)

Trois workflows n8n pour **trier une boîte Gmail avec Jev** — sans LLM génératif :
Jev rend une **décision typée** (bucket) + une **probabilité de confiance**, et le
workflow route automatiquement… ou renvoie à l'humain si la confiance est trop faible.

**BYOK** : chaque workflow appelle OpenRouter via une **credential Header Auth**
(`Name: Authorization`, `Value: Bearer sk-or-…`) — à créer une fois dans n8n, puis à
sélectionner sur le nœud HTTP `JEV decide`. Aucune clé n'est stockée en clair dans les
fichiers exportés.

## Les 3 workflows

| Fichier | Workflow n8n | Ce qu'il fait |
|---|---|---|
| `n8n_jev_triage.json` | JEV — Triage email (OpenRouter / TypeSafe) | Le socle : `Start → Prepare state → JEV decide → IF(confiance < 0.6) → Routage auto / Revue humaine`. Un email, une décision. |
| `n8n_jev_gmail_batch.json` | JEV — Tri emails Gmail (LOT, 1 appel) | **Le plus spectaculaire** : `Gmail (10 derniers) → Empaqueter → JEV decide (lot, 1 seul appel) → Dépaqueter → Router par bucket → 6 étiquettes`. Un appel HTTP pour N mails. |
| `n8n_jev_gmail_labels.json` | JEV — Tri emails Gmail (etiquettes) | Variante déclenchée par **Gmail Trigger** (temps réel) : classifie chaque mail entrant et applique l'étiquette du bucket. |

## Les buckets

`À revoir (humain)` · `Facturation` · `Sécurité` · `Newsletter` · `Perso` · `Spam_JEV`

## Import

1. n8n → **Import from File** → choisir le `.json`.
2. Ouvrir le nœud Gmail → **re-sélectionner ton compte** (les credentials ne sont pas
   exportés dans le fichier — `REPLACE_ME`).
3. Sur le nœud HTTP `JEV decide` : mettre ta clé OpenRouter (credential Header Auth).
4. Exécuter manuellement (`Execute workflow`) pour la démo.

## Contrat JEV utilisé

```
POST https://openrouter.ai/api/alpha/decisions
Authorization: Bearer <OPENROUTER_API_KEY>
{ "model": "typesafe/jev-1.13", "state": …, "questions": { … "type": "choice" … } }
```

Le **state** porte le(s) mail(s) à juger ; la **question** est de type `choice` avec
un `criteria` par bucket. La réponse renvoie `choice` + `probabilities` + `confidence`.

> Idée à montrer en live : la **confiance calibrée** sert de garde-fou —
> sous un seuil (0,6 / 0,7), on n'automatise pas, on renvoie à l'humain.
