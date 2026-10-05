#!/usr/bin/env python3
"""
compare_local_vs_jev.py — Démo meetup : le même aiguillage, deux moteurs.

  - LOCAL  : micro-service `routerd` (pattern open-source self-hosted, $0, CPU)
  - CLOUD  : JEV TypeSafe via OpenRouter (le vrai produit, ~$0.000016/décision)

Les deux renvoient le MÊME format -> on peut les mettre côte à côte, et
basculer de l'un à l'autre sans changer le reste du workflow (n8n inclus).

Usage :
  python3 compare_local_vs_jev.py                 # compare (local si dispo)
  python3 compare_local_vs_jev.py --cloud-only    # JEV seul (pas de service local)
  python3 compare_local_vs_jev.py --runs 3        # répéter pour la moyenne de latence
"""

from __future__ import annotations

import argparse
import json
import statistics
import urllib.error
import urllib.request

import jev_cloud

LOCAL_URL = "http://127.0.0.1:8790/decide"
LOCAL_HEALTH = "http://127.0.0.1:8790/health"

CASES = [
    {
        "tag": "inbox-triage",
        "state": (
            "Objet: URGENT - mon paiement est bloqué depuis 3 jours\n"
            "De: client@acme.fr\n\nBonjour, impossible de finaliser mon paiement, "
            "la page plante à chaque essai. Personne ne me répond depuis lundi, "
            "c'est urgent pour ma commande. Merci."
        ),
        "question": "Quel est le type de ce message ?",
        "options": ["client urgent", "demande admin", "spam", "newsletter"],
        "threshold": 0.6,
    },
    {
        "tag": "content-routing",
        "state": (
            "Contenu: retour d'expérience sur un atelier de code pour enfants de 8 ans, "
            "photos des robots, ton convivial, public = parents et familles locales."
        ),
        "question": "Vers quelle chaîne publier ce contenu ?",
        "options": ["research", "linkedin", "twitter", "instagram", "facebook"],
        "threshold": 0.5,
    },
]


def local_up() -> bool:
    try:
        with urllib.request.urlopen(LOCAL_HEALTH, timeout=2) as r:
            return json.load(r).get("status") == "ok"
    except Exception:  # noqa: BLE001
        return False


def call_local(case: dict) -> dict:
    req = urllib.request.Request(
        LOCAL_URL,
        data=json.dumps(case).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def _fmt(label: str, res: dict, cost: bool = False) -> str:
    conf = res.get("confidence")
    confs = f"{conf:.3f}" if isinstance(conf, (int, float)) else "n/a"
    tail = f" cost=${res.get('cost_usd'):.8f}" if cost and res.get("cost_usd") is not None else ""
    flag = "  ⚠ needs_review" if res.get("needs_review") else ""
    return (
        f"    {label:<6} -> {res.get('choice')!r:<18} p={confs} "
        f"lat={res.get('latency_ms'):>7} ms{tail}{flag}"
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cloud-only", action="store_true")
    ap.add_argument("--runs", type=int, default=1)
    args = ap.parse_args()

    have_local = (not args.cloud_only) and local_up()
    if not have_local:
        print("· service local `routerd` non détecté -> JEV cloud uniquement\n")

    cloud_lat, local_lat = [], []
    for case in CASES:
        print(f"[{case['tag']}]  {case['question']}  options={case['options']}")
        res_c = jev_cloud.decide(
            case["state"], case["question"], case["options"], threshold=case["threshold"]
        )
        print(_fmt("JEV", res_c, cost=True))
        cloud_lat.append(res_c["latency_ms"])

        if have_local:
            try:
                res_l = call_local(case)
                print(_fmt("LOCAL", res_l))
                local_lat.append(res_l["latency_ms"])
            except Exception as exc:  # noqa: BLE001
                print(f"    LOCAL  -> erreur: {exc}")
        print()

    print("— moyennes —")
    print(f"  JEV cloud : {statistics.mean(cloud_lat):.0f} ms  (~$0.000016/décision)")
    if local_lat:
        print(f"  LOCAL     : {statistics.mean(local_lat):.0f} ms  ($0)")
    print("\nÀ retenir : même contrat, deux économies -> 0 €/offline vs 1/1000 centime/appel.")


if __name__ == "__main__":
    main()
