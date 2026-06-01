#!/usr/bin/env bash
# Fires /api/cron with the bearer token. Called every 4 hours by crontab.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then
  echo "$(date -Iseconds) ERROR: .env.local missing" >&2
  exit 1
fi

# Source CRON_SECRET without leaking other env vars to a child process
CRON_SECRET=$(grep "^CRON_SECRET=" .env.local | cut -d= -f2- | tr -d '"')

if [ -z "$CRON_SECRET" ]; then
  echo "$(date -Iseconds) ERROR: CRON_SECRET not set in .env.local" >&2
  exit 1
fi

# 5-minute timeout — cron typically takes 2-4 min
RESPONSE=$(curl -sS --max-time 300 \
  -H "Authorization: Bearer $CRON_SECRET" \
  http://127.0.0.1:3000/api/cron 2>&1) || {
  echo "$(date -Iseconds) ERROR: cron call failed: $RESPONSE" >&2
  exit 1
}

echo "$(date -Iseconds) cron OK: $RESPONSE"
