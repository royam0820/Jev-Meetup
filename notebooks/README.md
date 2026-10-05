# Notebooks Colab

Notebooks autonomes, à ouvrir dans Google Colab (ou Jupyter). Ouvrir le notebook,
lancer la cellule de config, coller sa clé **OpenRouter** (`sk-or-…`) — la clé est
demandée via `getpass` et **jamais écrite dans le notebook**.

| Notebook | Sujet |
|---|---|
| [`jev_carwash_state_definition.ipynb`](jev_carwash_state_definition.ipynb) | **Pourquoi la définition du `state` compte** — le même problème (laver sa voiture, carwash à 50 m) en 2 versions : state mal défini vs bien défini. JEV rend une décision différente alors que le fait (50 m) ne change pas. |

## Idée clé

> **Type-safe ≠ world-safe.** Un output peut être parfaitement typé tout en étant une
> mauvaise décision si le `state` ne contient pas les contraintes déterminantes.
> JEV décide sur le monde que vous lui décrivez, pas sur le monde que vous aviez en tête.

## Contrat JEV (OpenRouter)

```
POST https://openrouter.ai/api/alpha/decisions
Authorization: Bearer <OPENROUTER_API_KEY>
{ "model": "typesafe/jev-1.13", "state": …, "questions": { … } }
```
