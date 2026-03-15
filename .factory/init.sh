#!/bin/bash
set -e

echo "M3 Designer Task Tracking - Environment Setup"
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

echo "Environment ready for M3 mission"
echo "Frontend: http://127.0.0.1:3101"
echo "Backend: http://127.0.0.1:3100"
