#!/bin/bash
set -e

echo "MBD Layout Consistency Mission - Environment Setup"
echo "==============================================="

if [ ! -f "package.json" ]; then
  echo "Error: Not in plant3d-web directory"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Checking mission-relevant local services..."
if curl -sf http://127.0.0.1:3101 > /dev/null; then
  echo "Frontend: reachable on http://127.0.0.1:3101"
else
  echo "Frontend: not running yet on http://127.0.0.1:3101 (workers may start it if needed)"
fi

if curl -sf http://127.0.0.1:3100/api/health > /dev/null; then
  echo "Backend: reachable on http://127.0.0.1:3100/api/health (optional for this mission)"
else
  echo "Backend: not reachable on http://127.0.0.1:3100/api/health (optional unless a worker needs a spot check)"
fi

echo "Environment ready for the MBD layout consistency mission"
echo "Primary verification surfaces:"
echo "- src/composables/useMbdPipeAnnotationThree.ts"
echo "- src/api/mbdPipeApi.ts"
echo "- src/composables/mbd/"
echo "- src/composables/useMbdPipeAnnotationThree.flyTo.test.ts"
echo "- src/fixtures/bran-test-data.test.ts"
echo "Reminder: preserve unrelated dirty-worktree changes and stay frontend-first."
