#!/usr/bin/env bash
# Repeatable deploy. Run as 'idealland' user from ~/idealland-ai-system.
# Safe to run any time — no destructive operations.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== IdealLand deploy ==="
echo "  branch:  $(git rev-parse --abbrev-ref HEAD)"
echo "  commit:  $(git rev-parse --short HEAD)"
echo "  date:    $(date)"
echo ""

if [ ! -f .env.local ]; then
  echo "ERROR: .env.local missing. Copy from deploy/env.template and fill in keys."
  exit 1
fi

echo "[1/6] git pull"
git pull --ff-only

echo "[2/6] npm ci (clean install from lockfile)"
npm ci --silent

echo "[3/6] prisma generate"
npx prisma generate

echo "[4/6] prisma migrate deploy (production-safe, applies pending migrations only)"
npx prisma migrate deploy

echo "[5/6] next build"
npm run build

echo "[6/6] pm2 reload (zero-downtime if already running, start if not)"
if pm2 list | grep -q "idealland"; then
  pm2 reload idealland
else
  pm2 start deploy/ecosystem.config.js
  pm2 save
fi

echo ""
echo "=== Deploy complete ==="
pm2 status idealland
echo ""
echo "App: http://localhost:3000  (proxied via nginx → https://your-domain)"
