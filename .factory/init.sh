#!/bin/bash
set -euo pipefail

echo "Annotation Refactor Mission bootstrap"
echo "================================="

if [ ! -f "package.json" ]; then
  echo "Error: run this script from D:/work/plant-code/plant3d-web" >&2
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing frontend dependencies..."
  npm install
else
  echo "node_modules already present; skipping install"
fi

echo "Checking mission ports (3101 frontend, 3100 backend, 8020 support service, 9222 reserved)..."
if curl -sf http://127.0.0.1:3101 > /dev/null; then
  echo "Frontend reachable on http://127.0.0.1:3101"
else
  echo "Frontend not running yet on http://127.0.0.1:3101"
fi

if curl -sf http://127.0.0.1:3100/api/health > /dev/null; then
  echo "Backend reachable on http://127.0.0.1:3100/api/health"
else
  echo "Backend not running yet on http://127.0.0.1:3100/api/health"
fi

if curl -sf http://127.0.0.1:8020 > /dev/null; then
  echo "Supporting service responded on http://127.0.0.1:8020"
else
  echo "No response detected on http://127.0.0.1:8020 (only needed for some contract checks)"
fi

echo "Reminder: preserve unrelated dirty worktree files, do not use port 9222, and do not run the mission runner from this bootstrap."
echo "Recommended baseline validators once code changes exist:"
echo "- npm run type-check"
echo "- npm run lint"
echo "- npm test"
echo "- focused vitest and curl probes per assigned milestone"
