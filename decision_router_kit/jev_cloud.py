#!/usr/bin/env python3
"""
jev_cloud.py — Client JEV (TypeSafe) via OpenRouter.

Même *contrat* que le micro-service local `routerd` : on lui donne un ÉTAT,
une QUESTION (critère) et des OPTIONS, il renvoie une décision typée +
distribution de probabilités. Sauf qu'ici la décision est calculée par le vrai
modèle JEV (`typesafe/jev-1.13`) servi par OpenRouter.

Endpoint : POST https://openrouter.ai/api/alpha/decisions   (alpha, PAS chat/completions)
Prix     : $0.042 / M tokens in, sortie gratuite  -> ~$0.000015 / décision
Ctx      : 32 000 tokens

Types de question supportés par JEV :
  - choice : criteria = {label: description, ...}          -> choice + probabilities + confidence
  - noul   : criteria = {"true": desc, "false": desc}       -> noul (probabilité de "oui")
  - score  : criteria = [{"label","description"}, ...]      -> score + legend + probabilities

Usage CLI :
  python3 jev_cloud.py --state "Email: URGENT mon paiement est bloqué" \
      --question "Classer ce message" \
      --option "client urgent" --option "demande admin" --option "spam" --option "newsletter" \
      --threshold 0.6

  # noul :
  python3 jev_cloud.py --type noul --state "..." --question "Est-ce urgent ?"

Stdlib uniquement (urllib) : facile à montrer / copier au meetup.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request

ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
DEFAULT_MODEL = "typesafe/jev-1.13"
CONFIG_PATH = "/data/.openclaw/openclaw.json"


def _api_key() -> str:
    key = os.environ.get("OPENROUTER_API_KEY")
    if key:
        return key
    # Fallback pratique sur le VPS : lit la clé depuis la config OpenClaw.
    try:
        with open(CONFIG_PATH, encoding="utf-8") as fh:
            return json.load(fh)["env"]["OPENROUTER_API_KEY"]
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(
            "OPENROUTER_API_KEY introuvable (env ou %s)" % CONFIG_PATH
        ) from exc


def _post(payload: dict, timeout: float = 40.0) -> dict:
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + _api_key(),
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        raise SystemExit(f"JEV API {exc.code}: {body[:500]}") from exc


def decide(
    state: str,
    question: str,
    options: list[str] | None = None,
    *,
    qtype: str = "choice",
    criteria: dict | list | None = None,
    threshold: float = 0.0,
    model: str = DEFAULT_MODEL,
    qid: str = "decision",
) -> dict:
    """Décision JEV, renvoyée au format `routerd` (swap-ready).

    qtype="choice" -> options (labels) ; criteria optionnel {label: description}
    qtype="noul"   -> criteria {"true":..., "false":...}
    qtype="score"  -> criteria [{"label","description"}, ...]
    """
    if qtype == "choice":
        if criteria is None:
            if not options:
                raise ValueError("choice: options ou criteria requis")
            # Repli : label = description (JEV exige un record de criteria).
            criteria = {o: o for o in options}
        elif not isinstance(criteria, dict):
            raise ValueError("choice: criteria doit être un record {label: description}")
        options = options or list(criteria.keys())
    elif qtype == "noul":
        # JEV exige true ET false ; on met un repli neutre si non fournis.
        criteria = criteria or {"true": "oui", "false": "non"}
    elif qtype == "score":
        if not criteria:
            raise ValueError("score: criteria = [{'label','description'}, ...] requis")

    t0 = time.perf_counter()
    data = _post(
        {
            "model": model,
            "state": state,
            "questions": {
                qid: {"type": qtype, "instructions": question, "criteria": criteria}
            },
        }
    )
    latency_ms = (time.perf_counter() - t0) * 1000
    usage = data.get("usage", {})
    ans = data["answers"][qid]

    out = {
        "model": data.get("model"),
        "provider": data.get("provider"),
        "qtype": qtype,
        "latency_ms": round(latency_ms, 1),
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
        "generated_tokens": 0,
        "cost_usd": usage.get("cost"),
        "threshold": threshold,
        "id": data.get("id"),
    }

    if qtype == "choice":
        probs = ans.get("probabilities", {})
        ranked = sorted(probs.items(), key=lambda x: x[1], reverse=True)
        conf = ans.get("confidence")
        out.update(
            choice=ans.get("choice"),
            confidence=conf,
            probabilities=probs,
            ranking=[{"option": o, "p": p} for o, p in ranked],
            needs_review=bool(threshold and conf is not None and conf < threshold),
        )
    elif qtype == "noul":
        p = ans.get("noul")
        out.update(
            noul=p,
            verdict="oui" if (p or 0) >= 0.5 else "non",
            confidence=p,
            needs_review=bool(threshold and p is not None and abs(p - 0.5) * 2 < threshold),
        )
    elif qtype == "score":
        out.update(
            score=ans.get("score"),
            legend=ans.get("legend"),
            probabilities=ans.get("probabilities"),
            confidence=ans.get("confidence"),
            needs_review=bool(threshold and (ans.get("confidence") or 0) < threshold),
        )
    else:
        out.update(raw=ans)

    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Décision JEV (TypeSafe) via OpenRouter")
    ap.add_argument("--state", required=True)
    ap.add_argument("--question", required=True)
    ap.add_argument("--option", action="append", default=[], help="répéter par option (choice)")
    ap.add_argument("--type", default="choice", choices=["choice", "noul", "score"])
    ap.add_argument("--threshold", type=float, default=0.0)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    args = ap.parse_args()

    res = decide(
        args.state,
        args.question,
        args.option,
        qtype=args.type,
        threshold=args.threshold,
        model=args.model,
    )
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
