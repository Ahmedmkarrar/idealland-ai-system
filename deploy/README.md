# IdealLand Deploy Runbook — DigitalOcean Droplet

End-to-end deploy of the IdealLand automation dashboard to a fresh DigitalOcean droplet. Targeted at the **$6/month Basic Droplet** (1 vCPU, 1 GB RAM, 25 GB SSD) — plenty for SQLite + the scraping + cron workload.

## What you end up with

- App running on `https://your-domain.tld` via Nginx + Let's Encrypt
- PM2 keeping it alive across restarts/crashes
- Linux cron hitting `/api/cron` every 4 hours
- SQLite DB backed up daily to `/var/backups/idealland/`
- A single `~/idealland-ai-system/deploy/deploy.sh` command for future deploys

## Prerequisites (you, ~10 minutes)

1. **Create the droplet** at https://cloud.digitalocean.com/droplets/new
   - Image: **Ubuntu 24.04 LTS**
   - Plan: **Basic / Regular / $6/mo** (1 vCPU, 1 GB RAM)
   - Region: **London (lon1)** (closest to the council portals + Lucy)
   - Auth: **SSH key** (paste your `~/.ssh/id_ed25519.pub` from your laptop)
   - Hostname: `idealland-prod`
2. **Point a domain** at the droplet IP (`A` record). If you don't have one yet, you can use the droplet IP for HTTP and skip Let's Encrypt — see step 6.
3. **SSH in from your laptop** to confirm access:
   ```bash
   ssh root@<DROPLET_IP>
   ```

Once you have the IP and (optionally) a domain pointing at it, paste them to AK and the rest is automated.

## Deploy steps (automated)

### 1. Bootstrap the droplet (one-time)

Run from your laptop:

```bash
scp deploy/setup-droplet.sh root@<DROPLET_IP>:/root/setup-droplet.sh
ssh root@<DROPLET_IP> 'bash /root/setup-droplet.sh'
```

This installs Node 20 LTS, PM2, Nginx, Certbot, fail2ban, ufw, and creates a non-root `idealland` user. Runs in ~3 minutes.

### 2. Clone the repo on the droplet

```bash
ssh idealland@<DROPLET_IP>
git clone https://github.com/Ahmedmkarrar/idealland-ai-system.git
cd idealland-ai-system
```

### 3. Drop in production .env.local

```bash
# On the droplet:
cp deploy/env.template .env.local
nano .env.local   # paste your real keys
```

Keys you need:
- `DASHBOARD_PASSWORD` — generate fresh: `openssl rand -base64 24`
- `CRON_SECRET` — generate fresh: `openssl rand -hex 32`
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY` — your existing keys (or rotated ones)
- `ALERT_EMAIL_FROM=alerts@idealland.co.uk`, `ALERT_EMAIL_TO=admin@idealland.co.uk`

### 4. First deploy

```bash
# On the droplet, as idealland user:
bash deploy/deploy.sh
```

This: `npm ci` → `npx prisma generate` → `npx prisma migrate deploy` → `npm run build` → `pm2 start ecosystem.config.js` → `pm2 save`.

App is now running on `http://localhost:3000` on the droplet.

### 5. Configure Nginx (HTTP first)

```bash
# As root:
sudo cp /home/idealland/idealland-ai-system/deploy/nginx.conf.template /etc/nginx/sites-available/idealland
# Edit the file, replace SERVER_NAME with your domain or droplet IP
sudo nano /etc/nginx/sites-available/idealland
sudo ln -sf /etc/nginx/sites-available/idealland /etc/nginx/sites-enabled/idealland
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

App now reachable on `http://your-domain.tld`.

### 6. HTTPS via Let's Encrypt (skip if using IP only)

```bash
sudo certbot --nginx -d your-domain.tld --non-interactive --agree-tos -m admin@idealland.co.uk
```

Certbot edits the Nginx config in place and sets up auto-renewal via systemd timer. App now on `https://your-domain.tld`.

### 7. Install the cron

```bash
# As idealland user:
bash deploy/install-cron.sh
```

This adds `0 */4 * * * /home/idealland/idealland-ai-system/deploy/run-cron.sh` to the idealland user's crontab.

### 8. Daily DB backup

Already set up by `setup-droplet.sh` — backs up `prisma/dev.db` to `/var/backups/idealland/dev-YYYY-MM-DD.db` at 3 AM, keeps 14 days.

## Future deploys (after step 1 once)

```bash
ssh idealland@<DROPLET_IP>
cd idealland-ai-system
bash deploy/deploy.sh
```

That's it. Pulls latest, regenerates Prisma, runs new migrations, rebuilds Next, reloads PM2.

## Verify it's working

```bash
# On the droplet:
pm2 status                                          # should show "online"
curl -s http://localhost:3000/api/config-status     # should return JSON
sudo systemctl status nginx                         # should be active
crontab -l                                          # should show the cron entry
ls -la /var/backups/idealland/                      # should have at least one .db
```

From your laptop (or any browser):
```
https://your-domain.tld
```
You'll get the login page. Use `DASHBOARD_PASSWORD` from `.env.local`.

## Operations cheat-sheet

| Want to | Command (on droplet as `idealland`) |
|---|---|
| See app logs | `pm2 logs idealland --lines 100` |
| Restart app | `pm2 restart idealland` |
| Watch real-time logs | `pm2 logs idealland` |
| Manually trigger cron | `bash deploy/run-cron.sh` |
| Tail nginx access | `sudo tail -f /var/log/nginx/access.log` |
| Tail nginx errors | `sudo tail -f /var/log/nginx/error.log` |
| Renew SSL manually | `sudo certbot renew` |
| Check disk usage | `df -h /` |
| Check memory | `free -h` |
| Pull latest + redeploy | `bash deploy/deploy.sh` |
| Restore DB backup | `cp /var/backups/idealland/dev-YYYY-MM-DD.db prisma/dev.db && pm2 restart idealland` |

## When something breaks

1. `pm2 logs idealland --lines 200` — app errors
2. `sudo tail -50 /var/log/nginx/error.log` — proxy/SSL issues
3. `pm2 describe idealland` — restart count, memory, uptime
4. `bash deploy/healthcheck.sh` — runs all checks and reports red/green

If you're stuck, ping AK with the output of `bash deploy/healthcheck.sh`.
