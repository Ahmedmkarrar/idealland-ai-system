#!/usr/bin/env bash
# Quick green/red board for the running deployment.
# Run on the droplet: bash ~/idealland-ai-system/deploy/healthcheck.sh
set -uo pipefail

cd "$(dirname "$0")/.."

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

ok()    { echo -e "  ${GREEN}✅${NC} $1"; }
fail()  { echo -e "  ${RED}❌${NC} $1"; }
warn()  { echo -e "  ${YELLOW}🟡${NC} $1"; }

echo "=== IdealLand healthcheck ($(date -Iseconds)) ==="

# 1. PM2 process
if pm2 list 2>/dev/null | grep -q "idealland.*online"; then
  ok "PM2 process online"
else
  fail "PM2 process not online (run: pm2 status)"
fi

# 2. App responds locally
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3000/api/config-status)
if [ "$HTTP" = "200" ]; then
  ok "App responding (HTTP 200 on /api/config-status)"
else
  fail "App not responding (got HTTP $HTTP)"
fi

# 3. Nginx
if systemctl is-active --quiet nginx 2>/dev/null; then
  ok "Nginx active"
else
  fail "Nginx not active (run: sudo systemctl status nginx)"
fi

# 4. Cron installed
if crontab -l 2>/dev/null | grep -q "run-cron.sh"; then
  ok "Cron installed for $(whoami)"
else
  warn "Cron not installed (run: bash deploy/install-cron.sh)"
fi

# 5. Latest cron run (if log exists)
if [ -f "$HOME/cron.log" ]; then
  LAST=$(tail -1 "$HOME/cron.log" 2>/dev/null | head -c 120)
  if [ -n "$LAST" ]; then
    ok "Last cron log line: $LAST"
  else
    warn "Cron log empty"
  fi
else
  warn "No cron.log yet (cron hasn't fired)"
fi

# 6. DB backups
BACKUP_COUNT=$(ls /var/backups/idealland/dev-*.db 2>/dev/null | wc -l | tr -d ' ')
if [ "$BACKUP_COUNT" -gt 0 ]; then
  LATEST=$(ls -t /var/backups/idealland/dev-*.db 2>/dev/null | head -1)
  ok "DB backups present ($BACKUP_COUNT, latest: $(basename $LATEST))"
else
  warn "No DB backups yet (cron runs at 3am)"
fi

# 7. SSL cert (only if certbot ran)
if [ -d /etc/letsencrypt/live ]; then
  EXPIRY=$(sudo find /etc/letsencrypt/live -name cert.pem -exec openssl x509 -enddate -noout -in {} \; 2>/dev/null | head -1)
  if [ -n "$EXPIRY" ]; then
    ok "SSL cert: $EXPIRY"
  fi
else
  warn "No Let's Encrypt cert (HTTP-only mode — fine if intentional)"
fi

# 8. Disk space
DISK_USED=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$DISK_USED" -lt 80 ]; then
  ok "Disk usage: ${DISK_USED}%"
else
  fail "Disk usage HIGH: ${DISK_USED}% (consider cleaning up)"
fi

# 9. Memory
MEM_FREE=$(free -m | awk 'NR==2 {print $7}')
if [ "$MEM_FREE" -gt 100 ]; then
  ok "Memory available: ${MEM_FREE} MB"
else
  warn "Memory low: ${MEM_FREE} MB available"
fi

echo ""
echo "Detailed status:"
pm2 status idealland 2>/dev/null | tail -10 || true
