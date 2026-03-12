#!/usr/bin/env bash
set -euo pipefail

FRONTEND_ROOT="/Volumes/DPC/work/plant-code/plant3d-web"
BACKEND_ROOT="/Volumes/DPC/work/plant-code/plant-model-gen"
INDEX_PATH="$BACKEND_ROOT/output/spatial_index.sqlite"

echo "[init] nearby-items mission environment check"

test -d "$FRONTEND_ROOT"
test -d "$BACKEND_ROOT"
test -f "$FRONTEND_ROOT/package.json"
test -f "$BACKEND_ROOT/Cargo.toml"

command -v npm >/dev/null
command -v cargo >/dev/null
command -v curl >/dev/null

if [ ! -d "$FRONTEND_ROOT/node_modules" ]; then
  echo "[init] warning: frontend node_modules missing; run frontend_install if validation needs local deps"
fi

if [ ! -f "$INDEX_PATH" ]; then
  echo "[init] warning: spatial index file missing at $INDEX_PATH"
else
  echo "[init] found spatial index at $INDEX_PATH"
fi

echo "[init] expected ports: backend=3100 frontend=3101"
echo "[init] done"
