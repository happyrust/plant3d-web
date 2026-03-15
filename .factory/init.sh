#!/usr/bin/env bash
set -euo pipefail

FRONTEND_ROOT="/Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2"
BACKEND_ROOT="/Volumes/DPC/work/plant-code/plant-model-gen"
VALIDATION_URL="http://127.0.0.1:3101/"

echo "[init] three-review M1-M2 mission environment check"

test -d "$FRONTEND_ROOT"
test -f "$FRONTEND_ROOT/package.json"
test -d "$BACKEND_ROOT"
test -f "$BACKEND_ROOT/Cargo.toml"

command -v npm >/dev/null
command -v npx >/dev/null
command -v cargo >/dev/null
command -v curl >/dev/null

if [ ! -d "$FRONTEND_ROOT/node_modules" ]; then
  echo "[init] warning: worktree node_modules missing; run commands.install before local validation in this worktree"
fi

echo "[init] frontend worktree: $FRONTEND_ROOT"
echo "[init] backend repo: $BACKEND_ROOT"
echo "[init] expected ports: backend=3100 frontend=3101"
echo "[init] primary validation url: $VALIDATION_URL"
echo "[init] note: use read-only eslint commands instead of npm run lint because the repo script uses --fix"
echo "[init] note: if port 3101 is occupied by another plant3d-web checkout, stop it before validating the mission worktree UI"
echo "[init] done"
