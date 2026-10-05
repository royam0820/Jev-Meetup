#!/usr/bin/env bash
# run_demo.sh — lance le moteur local `routerd` puis la démo du meetup.
#
# Usage :
#   ./run_demo.sh                 # moteur local + JEV (les 2 moteurs)
#   ./run_demo.sh --cloud         # JEV seul (ne démarre pas le moteur local)
#   ./run_demo.sh --keep          # laisse le moteur local tourner après la démo
#   ./run_demo.sh --model Qwen/Qwen3-1.7B --port 8790
#
# Sur le VPS : la clé OpenRouter se résout automatiquement (config OpenClaw).
# Sur un laptop : `export OPENROUTER_API_KEY=sk-or-…` (ou un .env) au préalable.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Localiser router_service.py : dépôt (local_engine/) ou workspace (../).
if [[ -f "$HERE/local_engine/router_service.py" ]]; then
  ENGINE="$HERE/local_engine/router_service.py"
elif [[ -f "$HERE/../router_service.py" ]]; then
  ENGINE="$(cd "$HERE/.." && pwd)/router_service.py"
else
  echo "❌ router_service.py introuvable (ni ./local_engine/ ni ../)" >&2
  exit 1
fi

PORT=8790
MODEL="Qwen/Qwen3-1.7B"
CLOUD_ONLY=0
KEEP=0
DEMO_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cloud) CLOUD_ONLY=1; DEMO_ARGS+=(--cloud); shift ;;
    --keep)  KEEP=1; shift ;;
    --port)  PORT="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    *)       DEMO_ARGS+=("$1"); shift ;;
  esac
done

HEALTH="http://127.0.0.1:${PORT}/health"
engine_up() { curl -fsS "$HEALTH" 2>/dev/null | grep -q '"status":"ok"'; }

ENGINE_PID=""
cleanup() {
  if [[ $KEEP -eq 0 && -n "$ENGINE_PID" ]]; then
    echo "→ arrêt du moteur local (pid $ENGINE_PID)"
    kill "$ENGINE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ $CLOUD_ONLY -eq 0 ]]; then
  if engine_up; then
    echo "✓ moteur local déjà UP sur :$PORT"
  else
    LOG="${TMPDIR:-/tmp}/routerd.log"
    echo "→ démarrage du moteur local ($MODEL) sur :$PORT … (cold start ~50 s)"
    python3 "$ENGINE" --model "$MODEL" --port "$PORT" >"$LOG" 2>&1 &
    ENGINE_PID=$!
    ready=0
    for _ in $(seq 1 90); do
      if engine_up; then ready=1; break; fi
      sleep 2
    done
    if [[ $ready -eq 1 ]]; then
      echo "✓ moteur local prêt"
    else
      echo "❌ le moteur n'a pas répondu en 180 s — log : $LOG" >&2
    fi
  fi
else
  echo "→ mode --cloud : moteur local ignoré"
fi

echo
echo "════════════════════════ DÉMO ════════════════════════"
python3 "$HERE/demo_meetup.py" ${DEMO_ARGS[@]+"${DEMO_ARGS[@]}"}
