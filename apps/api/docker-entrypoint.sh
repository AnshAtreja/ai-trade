#!/bin/sh
set -e

echo "Waiting for Postgres..."
ATTEMPTS=0
until node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$queryRaw\`SELECT 1\`.then(() => p.\$disconnect()).then(() => process.exit(0)).catch(() => process.exit(1));
" 2>/dev/null; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge 60 ]; then
    echo "Postgres did not become ready in time."
    exit 1
  fi
  sleep 1
done

echo "Applying Prisma migrations..."
npx prisma migrate deploy

echo "Starting TradePilot API on port ${PORT:-4000}..."
exec node dist/server.js
