#!/bin/bash
set -e

echo "M6+M7 Reviewer Annotation And Collaboration Mission - Environment Setup"
echo "==================================================================="

if [ ! -f "package.json" ]; then
  echo "Error: Not in plant3d-web directory"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Checking shared services..."
if curl -sf http://127.0.0.1:3100/api/health > /dev/null; then
  echo "Backend: reachable on http://127.0.0.1:3100"
else
  echo "Warning: backend on 3100 is not reachable yet"
fi

if curl -sf http://127.0.0.1:3101 > /dev/null; then
  echo "Frontend: reachable on http://127.0.0.1:3101"
else
  echo "Warning: frontend on 3101 is not reachable yet"
fi

echo "Environment ready for M6+M7 mission bootstrap"
echo "Frontend: http://127.0.0.1:3101"
echo "Backend:  http://127.0.0.1:3100"
echo "Note: seeded demo data must be generated before final reviewer/designer browser validation"
