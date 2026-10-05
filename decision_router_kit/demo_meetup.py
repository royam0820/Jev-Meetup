#!/usr/bin/env python3
"""
demo_meetup.py — Démo « scène » du meetup Aiguillage IA (8 octobre 2026).

Le MÊME cas, jugé par DEUX moteurs :
  - LOCAL  : Qwen3-1.7B servi par `routerd`  (self-hosted, $0, ~2-4 s, 2 vCPU)
  - CLOUD  : JEV (TypeSafe) via OpenRouter    (~0,3 s, ~$0,000015 / décision)

Affichage pensé pour un partage d'écran Zoom : 3 cas, barres de confiance,
badge de verdict (AUTO / REVUE HUMAINE).

Usage :
  python3 demo_meetup.py            # les 3 cas
  python3 demo_meetup.py --cloud    # JEV seul (si routerd éteint)
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request

try:
    import jev_cloud
except Exception:  # noqa: BLE001
    jev_cloud = None

LOCAL_URL = "http://127.0.0.1:8790/decide"
LOCAL_HEALTH = "http://127.0.0.1:8790/health"
THRESHOLD = 0.70

_TTY = sys.stdout.isatty()
_COL = {
    "reset": "\033[0m", "bold": "\033[1m", "dim": "\033[2m",
    "cyan": "\033[96m", "yellow": "\033[93m", "green": "\033[92m",
    "red": "\033[91m", "grey": "\033[90m", "mag": "\033[95m",
}


def col(name: str, s: str) -> str:
    return f"{_COL.get(name, '')}{s}{_COL['reset']}" if _TTY else s


# --------------------------------------------------------------------------
# Les 3 cas de la démo — narratif : accord → divergence → doute
# --------------------------------------------------------------------------
CASES = [
    {
        "n": "1",
        "tag": "Triage email",
        "why": "les deux moteurs sont d'accord — JEV le fait 10x plus vite",
        "state": (
            "Objet: URGENT - mon paiement est bloqué depuis 3 jours\n"
            "De: client@acme.fr\n\nBonjour, impossible de finaliser mon paiement, "
            "la page plante à chaque essai. Personne ne me répond depuis lundi, "
            "c'est urgent pour ma commande. Merci."
        ),
        "question": "Quel est le type de ce message ?",
        "options": ["client urgent", "demande admin", "spam", "newsletter"],
    },
    {
        "n": "2",
        "tag": "Routage réseaux",
        "why": "DIVERGENCE : le petit modèle local est confiant… et à côté",
        "state": (
            "Contenu: retour d'expérience sur un atelier de code pour enfants de 8 ans, "
            "photos des robots, ton convivial, public = parents et familles locales."
        ),
        "question": "Vers quelle chaîne publier ce contenu ?",
        "options": ["research", "linkedin", "twitter", "instagram", "facebook"],
    },
    {
        "n": "3",
        "tag": "Routage subtil (cas limite)",
        "why": "JEV lui-même hésite → il passe la main à un humain",
        "state": (
            "Post: photos de notre atelier robotique avec les enfants d'une école de "
            "Puteaux, merci à la mairie pour l'accueil, ton chaleureux."
        ),
        "question": "Vers quelle chaîne publier ce contenu ?",
        "options": ["research", "linkedin", "twitter", "instagram", "facebook"],
    },
]


def bar(p: float, width: int = 22) -> str:
    p = max(0.0, min(1.0, float(p or 0.0)))
    n = int(round(p * width))
    return "█" * n + "░" * (width - n)


def local_up() -> bool:
    try:
        with urllib.request.urlopen(LOCAL_HEALTH, timeout=2) as r:
            return json.load(r).get("status") == "ok"
    except Exception:  # noqa: BLE001
        return False


def call_local(case: dict, threshold: float = THRESHOLD) -> dict:
    payload = {**case, "threshold": threshold}
    req = urllib.request.Request(
        LOCAL_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=180) as r:
        out = json.load(r)
    out.setdefault("latency_ms", round((time.perf_counter() - t0) * 1000, 1))
    return out


def line(label: str, colour: str, res: dict, cost: bool = False) -> str:
    conf = res.get("confidence")
    conf_s = f"{conf:.2f}" if isinstance(conf, (int, float)) else "n/a"
    tail = ""
    if cost and res.get("cost_usd") is not None:
        tail = f"  ·  ${res['cost_usd']:.8f}"
    elif not cost:
        tail = "  ·  $0"
    lat = res.get("latency_ms")
    lat_s = f"{lat:>6.0f} ms" if isinstance(lat, (int, float)) else "     n/a"
    name = col(colour, f"{label:<5}")
    choice = f"{res.get('choice')!r:<14}"
    b = col(colour, bar(conf if isinstance(conf, (int, float)) else 0))
    return f"  {name} ┃ {choice} ├{b}┤ p={conf_s}  ·{lat_s}{tail}"


def verdict(res: dict) -> str:
    conf = res.get("confidence")
    review = res.get("needs_review")
    if review or (isinstance(conf, (int, float)) and conf < THRESHOLD):
        return col("yellow", "  →  ⚠  REVUE HUMAINE") + col(
            "grey", f"   (confiance {conf:.2f} < seuil {THRESHOLD:.2f} → on ne décide pas seul)"
        )
    return col("green", "  →  ✅ AUTO") + col(
        "grey", f"            (confiance {conf:.2f} ≥ seuil {THRESHOLD:.2f} → on laisse passer)"
    )


def main() -> None:
    cloud_only = "--cloud" in sys.argv
    have_local = (not cloud_only) and local_up()

    title = "Aiguillage IA — le même cas, deux moteurs"
    print()
    print(col("bold", col("mag", title)))
    print(col("grey", f"  LOCAL = Qwen3-1.7B self-hosted ($0)   ·   CLOUD = JEV TypeSafe via OpenRouter   ·   seuil {THRESHOLD:.2f}"))
    if not have_local:
        print(col("yellow", "  ⚠  moteur local `routerd` non détecté → JEV cloud uniquement (lance-le, sinon ce n'est pas la démo complète)"))
    print(col("grey", "  " + "─" * 74))

    jlat, llat = [], []
    for case in CASES:
        print()
        print(col("bold", f"  CAS {case['n']} · {case['tag']}") + col("grey", f"   — {case['why']}"))
        print(col("dim", f"  {case['question']}"))
        print(col("grey", f"  état : {case['state'][:96].replace(chr(10), ' ')}{'…' if len(case['state']) > 96 else ''}"))
        print()
        if jev_cloud is not None:
            rc = jev_cloud.decide(case["state"], case["question"], case["options"], threshold=THRESHOLD)
            print(line("JEV", "cyan", rc, cost=True))
            print(verdict(rc))
            jlat.append(rc["latency_ms"])
        if have_local:
            try:
                rl = call_local(case)
                print(line("LOCAL", "yellow", rl))
                print(verdict(rl))
                llat.append(rl["latency_ms"])
            except Exception as exc:  # noqa: BLE001
                print(col("red", f"  LOCAL  → erreur: {exc}"))
        print(col("grey", "  " + "─" * 74))

    print()
    if jlat:
        print(col("cyan", f"  JEV cloud : {sum(jlat)/len(jlat):.0f} ms / décision   ·   ~$0,000016 (1/1000 de centime)"))
    if llat:
        print(col("yellow", f"  LOCAL     : {sum(llat)/len(llat):.0f} ms / décision   ·   $0   ·   hors-ligne"))
    print(col("bold", "\n  À retenir : même contrat, deux économies. Le local est gratuit mais tranche"))
    print(col("bold", "  avec aplomb (même quand il se trompe) ; JEV est rapide, calibré —"))
    print(col("bold", "  et il dit quand il ne sait pas.\n"))


if __name__ == "__main__":
    main()
