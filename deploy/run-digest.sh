#!/usr/bin/env bash
# Fires /api/cron/digest with the bearer token. Called once each morning by
# crontab to send IdealLand the overnight summary email.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then
  echo "$(date -Iseconds) ERROR: .env.local missing" >&2
  exit 1
fi

CRON_SECRET=$(grep "^CRON_SECRET=" .env.local | cut -d= -f2- | tr -d '"')

if [ -z "$CRON_SECRET" ]; then
  echo "$(date -Iseconds) ERROR: CRON_SECRET not set in .env.local" >&2
  exit 1
fi

RESPONSE=$(curl -sS --max-time 120 \
  -H "Authorization: Bearer $CRON_SECRET" \
  http://127.0.0.1:3000/api/cron/digest 2>&1) || {
  echo "$(date -Iseconds) ERROR: digest call failed: $RESPONSE" >&2
  exit 1
}

echo "$(date -Iseconds) digest OK: $RESPONSE"
