#!/bin/bash
set -e

echo "M4 Review Workbench Mission - Environment Setup"
echo "============================================="

if [ ! -f "package.json" ]; then
  echo "Error: Not in plant3d-web directory"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Environment ready for M4 reviewer workbench mission"
echo "Frontend: http://127.0.0.1:3101"
echo "Backend:  http://127.0.0.1:3100"
echo "Note: reviewer-owned task seed data may still be required for full user-surface validation"
