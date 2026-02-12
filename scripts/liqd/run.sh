#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
RUNNER="$ROOT_DIR/scripts/liqd/rollout.mjs"

usage() {
  cat <<'USAGE'
Usage:
  scripts/liqd/run.sh --phase <0|1|2|3|4|5> [--watch] [--watch-minutes N]
  scripts/liqd/run.sh --all [--activate] [--watch] [--watch-minutes N]

Examples:
  scripts/liqd/run.sh --phase 0
  scripts/liqd/run.sh --phase 5 --watch --watch-minutes 60
  scripts/liqd/run.sh --all
  scripts/liqd/run.sh --all --activate --watch --watch-minutes 45

Notes:
  --all runs phases 0..4 by default.
  --all --activate runs phases 0..5.
USAGE
}

phase=""
run_all=0
activate=0
watch=0
watch_minutes="60"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase)
      phase="${2:-}"
      shift 2
      ;;
    --all)
      run_all=1
      shift
      ;;
    --activate)
      activate=1
      shift
      ;;
    --watch)
      watch=1
      shift
      ;;
    --watch-minutes)
      watch_minutes="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

run_phase() {
  local p="$1"
  echo "[liqd-run] running phase${p}"
  local args=("phase${p}")
  if [[ "$p" == "5" && "$watch" -eq 1 ]]; then
    args+=("--watch" "--watch-minutes=${watch_minutes}")
  fi
  node "$RUNNER" "${args[@]}"
}

if [[ "$run_all" -eq 1 ]]; then
  run_phase 0
  run_phase 1
  run_phase 2
  run_phase 3
  run_phase 4
  if [[ "$activate" -eq 1 ]]; then
    run_phase 5
  else
    echo "[liqd-run] skipped phase5 activation (use --activate to include)"
  fi
  exit 0
fi

if [[ -z "$phase" ]]; then
  usage
  exit 1
fi

case "$phase" in
  0|1|2|3|4|5) run_phase "$phase" ;;
  *)
    echo "Invalid phase: $phase" >&2
    usage
    exit 1
    ;;
esac

