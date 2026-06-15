#!/usr/bin/env bash
# Installs the IdealLand cron jobs for the current (idealland) user.
# Runs /api/cron every 4 hours + /api/cron/digest each morning at 08:00.
# Logs to ~/cron.log
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_SCRIPT="$REPO_DIR/deploy/run-cron.sh"
DIGEST_SCRIPT="$REPO_DIR/deploy/run-digest.sh"

if [ ! -x "$RUN_SCRIPT" ]; then
  chmod +x "$RUN_SCRIPT"
fi
if [ ! -x "$DIGEST_SCRIPT" ]; then
  chmod +x "$DIGEST_SCRIPT"
fi

# Scan every 4 hours; send the digest once each morning at 08:00 (server time).
CRON_LINE="0 */4 * * * $RUN_SCRIPT >> $HOME/cron.log 2>&1"
DIGEST_LINE="0 8 * * * $DIGEST_SCRIPT >> $HOME/cron.log 2>&1"

# Tolerant: if no crontab yet, `crontab -l` exits non-zero — `|| :` swallows it.
# Strip any prior IdealLand lines, then append the new ones.
{ crontab -l 2>/dev/null || :; } \
  | grep -v "run-cron.sh" \
  | grep -v "run-digest.sh" \
  | { cat -; echo "$CRON_LINE"; echo "$DIGEST_LINE"; } \
  | crontab -

echo "Installed cron:"
crontab -l | grep -E "run-cron|run-digest"
echo ""
echo "Logs will append to: $HOME/cron.log"
echo "Test scan now:       bash $RUN_SCRIPT"
echo "Test digest now:     bash $DIGEST_SCRIPT"
