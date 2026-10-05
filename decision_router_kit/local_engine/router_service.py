#!/usr/bin/env python3
"""
router_service.py — Micro-service de décision (pattern "openjev"/SemIf).

Expose un endpoint HTTP qui transforme un ÉTAT + une QUESTION + des OPTIONS
en une distribution de probabilités, SANS générer de texte. C'est le nœud
"aiguillage" que n8n peut appeler (HTTP Request node) pour brancher un workflow.

Inspiré de : TypeSafe Jev (System One) et de sa repro open-source
TheoLeeCJ/SemIf. Ici : lecteur de logits sur un petit modèle Qwen3 local -> $0.

Endpoints
    GET  /health                    -> état du service + modèle
    POST /decide                    -> décision typée + probabilités
    GET  /logs?limit=20             -> dernières décisions (audit / réglage seuil)

Lancement
    python3 router_service.py --model Qwen/Qwen3-1.7B --port 8790
"""

from __future__ import annotations

import argparse
import json
import math
import os
import time
from datetime import datetime, timezone

from fastapi import FastAPI
from pydantic import BaseModel, Field
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

LETTERS = "ABCDEFGHIJKLMNOP"
SYSTEM = (
    "Apply the supplied criterion to the supplied evidence. Choose exactly one listed "
    "option. Respond with only its uppercase letter, with no explanation or reasoning."
)
LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "decisions.jsonl")

STATE: dict = {"model": None, "tokenizer": None, "name": None, "ready": False, "started": None}


# ------------------------------- model ---------------------------------------
def load(model_name: str, dtype: str = "bfloat16"):
    dt = torch.bfloat16 if dtype == "bfloat16" else torch.float32
    STATE["tokenizer"] = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForCausalLM.from_pretrained(model_name, dtype=dt)
    model.eval()
    STATE["model"] = model
    STATE["name"] = model_name
    STATE["dtype"] = dtype
    STATE["device"] = str(next(model.parameters()).device)
    STATE["ready"] = True
    STATE["started"] = datetime.now(timezone.utc).isoformat()


def _softmax(values: list[float]) -> list[float]:
    m = max(values)
    w = [math.exp(v - m) for v in values]
    return [x / sum(w) for x in w]


def _slot_ids(tokenizer, count: int) -> list[int]:
    ids = []
    for letter in LETTERS[:count]:
        enc = tokenizer.encode(letter, add_special_tokens=False)
        if len(enc) != 1:
            raise ValueError(f"Option slot {letter!r} is not a single token")
        ids.append(enc[0])
    return ids


def _prompt(tokenizer, state, question, options) -> str:
    payload = {
        "evidence": state,
        "criterion": question,
        "options": [{"letter": LETTERS[i], "description": o} for i, o in enumerate(options)],
    }
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    return tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
    )


def decide(state, question, options, threshold: float = 0.0) -> dict:
    tokenizer, model = STATE["tokenizer"], STATE["model"]
    prompt = _prompt(tokenizer, state, question, options)
    ids = tokenizer.encode(prompt, add_special_tokens=False)
    slots = _slot_ids(tokenizer, len(options))
    device = next(model.parameters()).device
    inputs = {
        "input_ids": torch.tensor([ids], dtype=torch.long, device=device),
        "attention_mask": torch.ones((1, len(ids)), dtype=torch.long, device=device),
    }
    t0 = time.perf_counter()
    with torch.inference_mode():
        logits = model(**inputs).logits[0, -1, :].float()
    ms = (time.perf_counter() - t0) * 1000
    probs = _softmax([logits[t].item() for t in slots])
    ranked = sorted(zip(options, probs), key=lambda x: x[1], reverse=True)
    best, conf = ranked[0]
    return {
        "choice": best,
        "confidence": round(conf, 4),
        "probabilities": {o: round(p, 4) for o, p in zip(options, probs)},
        "ranking": [{"option": o, "p": round(p, 4)} for o, p in ranked],
        "needs_review": bool(threshold and conf < threshold),
        "threshold": threshold,
        "latency_ms": round(ms, 1),
        "input_tokens": len(ids),
        "generated_tokens": 0,
        "model": STATE["name"],
    }


def _log(record: dict) -> None:
    with open(LOG_PATH, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


# -------------------------------- api ----------------------------------------
app = FastAPI(title="Decision Router (openjev pattern)", version="0.1")


class DecideRequest(BaseModel):
    state: str = Field(..., description="Contexte / preuve, texte ou JSON sérialisé")
    question: str = Field(..., description="Le critère de décision")
    options: list[str] = Field(..., min_length=2, max_length=16)
    threshold: float = Field(0.0, ge=0.0, le=1.0, description="Seuil sous lequel needs_review=true")
    tag: str | None = Field(None, description="Étiquette libre du workflow appelant")


@app.get("/health")
def health():
    return {
        "status": "ok" if STATE["ready"] else "loading",
        "model": STATE["name"],
        "dtype": STATE.get("dtype"),
        "device": STATE.get("device"),
        "readout": "native last-position logits restricted to declared option slots",
        "generated_tokens": 0,
    }


@app.post("/decide")
def decide_endpoint(req: DecideRequest):
    result = decide(req.state, req.question, req.options, req.threshold)
    result["tag"] = req.tag
    result["question"] = req.question
    result["ts"] = datetime.now(timezone.utc).isoformat()
    _log(result)
    return result


@app.get("/logs")
def logs(limit: int = 20):
    if not os.path.exists(LOG_PATH):
        return {"count": 0, "items": []}
    with open(LOG_PATH, encoding="utf-8") as fh:
        lines = fh.readlines()[-limit:]
    return {"count": len(lines), "items": [json.loads(x) for x in lines]}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen3-1.7B")
    ap.add_argument("--dtype", default="bfloat16", choices=["bfloat16", "float32"])
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8790)
    args = ap.parse_args()

    print(f"→ chargement {args.model} ({args.dtype}) ...", flush=True)
    load(args.model, args.dtype)
    print("→ modèle prêt, service UP", flush=True)
    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
