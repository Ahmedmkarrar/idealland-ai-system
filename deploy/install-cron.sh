#!/usr/bin/env bash
# Installs the IdealLand cron job for the current (idealland) user.
# Runs /api/cron every 4 hours, logs to ~/cron.log
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_SCRIPT="$REPO_DIR/deploy/run-cron.sh"

if [ ! -x "$RUN_SCRIPT" ]; then
  chmod +x "$RUN_SCRIPT"
fi

CRON_LINE="0 */4 * * * $RUN_SCRIPT >> $HOME/cron.log 2>&1"

# Tolerant: if no crontab yet, `crontab -l` exits non-zero — `|| :` swallows it.
# Strip any prior IdealLand line, then append the new one.
{ crontab -l 2>/dev/null || :; } | grep -v "run-cron.sh" | { cat -; echo "$CRON_LINE"; } | crontab -

echo "Installed cron:"
crontab -l | grep run-cron
echo ""
echo "Logs will append to: $HOME/cron.log"
echo "Test it now:        bash $RUN_SCRIPT"
