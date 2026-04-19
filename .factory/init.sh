#!/bin/bash
# Idempotent environment setup for annotation refactor mission
# Runs at the start of each worker session

cd "D:/work/plant-code/plant3d-web" || exit 1

# Install frontend dependencies if needed
if [ ! -d "node_modules" ]; then
  npm install
fi

# Verify TypeScript compiles
npm run type-check 2>/dev/null || echo "Warning: type-check had issues"

echo "Init complete. Frontend ready at D:/work/plant-code/plant3d-web"
echo "Backend at D:/work/plant-code/plant-model-gen"
echo "SurrealDB on localhost:8020"
