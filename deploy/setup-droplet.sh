#!/usr/bin/env bash
# One-time bootstrap for a fresh Ubuntu 24.04 droplet.
# Run as root: bash /root/setup-droplet.sh
set -euo pipefail

echo "=== IdealLand droplet bootstrap ==="
echo "  hostname: $(hostname)"
echo "  date:     $(date)"
echo ""

if [ "$EUID" -ne 0 ]; then
  echo "Must run as root. Try: sudo bash $0"
  exit 1
fi

echo "[1/8] Update apt + install base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
  curl ca-certificates gnupg lsb-release \
  build-essential git nginx ufw fail2ban \
  python3 python3-pip sqlite3 unzip jq

echo "[2/8] Install Node.js 20 LTS via NodeSource"
if ! command -v node &>/dev/null || [ "$(node -v | cut -d. -f1)" != "v20" ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
node -v
npm -v

echo "[3/8] Install PM2 globally"
npm install -g pm2@latest
pm2 -v

echo "[4/8] Install Certbot for Let's Encrypt"
apt-get install -y -qq certbot python3-certbot-nginx

echo "[5/8] Create dedicated 'idealland' user (no sudo)"
if ! id idealland &>/dev/null; then
  useradd -m -s /bin/bash idealland
  # Copy root's authorized_keys so you can SSH in as idealland from your laptop
  mkdir -p /home/idealland/.ssh
  if [ -f /root/.ssh/authorized_keys ]; then
    cp /root/.ssh/authorized_keys /home/idealland/.ssh/authorized_keys
  fi
  chown -R idealland:idealland /home/idealland/.ssh
  chmod 700 /home/idealland/.ssh
  chmod 600 /home/idealland/.ssh/authorized_keys 2>/dev/null || true
  echo "  created user idealland with SSH key access"
else
  echo "  user idealland already exists"
fi

echo "[6/8] Firewall: allow SSH, HTTP, HTTPS only"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status

echo "[7/8] PM2 systemd integration (so app survives reboots)"
pm2 startup systemd -u idealland --hp /home/idealland | tail -1 | bash || true

echo "[8/8] Daily SQLite backup cron (root crontab, runs at 3 AM)"
mkdir -p /var/backups/idealland
chown idealland:idealland /var/backups/idealland
BACKUP_LINE='0 3 * * * /usr/bin/sqlite3 /home/idealland/idealland-ai-system/prisma/dev.db ".backup /var/backups/idealland/dev-$(date +\%Y-\%m-\%d).db" && /usr/bin/find /var/backups/idealland -name "dev-*.db" -mtime +14 -delete'
( crontab -l 2>/dev/null | grep -v "idealland.*dev.db" ; echo "$BACKUP_LINE" ) | crontab -
echo "  cron installed: daily backup at 3am, 14-day retention"

echo ""
echo "=== Bootstrap complete ==="
echo ""
echo "Next steps (from your laptop, as 'idealland' user on droplet):"
echo "  ssh idealland@$(curl -s ifconfig.me)"
echo "  git clone https://github.com/Ahmedmkarrar/idealland-ai-system.git"
echo "  cd idealland-ai-system"
echo "  cp deploy/env.template .env.local && nano .env.local   # fill in keys"
echo "  bash deploy/deploy.sh"
echo ""
