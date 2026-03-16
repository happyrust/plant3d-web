#!/bin/bash
set -e

echo "M5 Consistency Follow-up - Environment Setup"
echo "=============================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
  echo "Error: Not in plant3d-web directory"
  exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Environment ready for M5 consistency follow-up"
echo "Frontend: http://127.0.0.1:3101"
echo "Backend: http://127.0.0.1:3100"
