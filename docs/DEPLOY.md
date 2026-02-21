# One21 — Deploy Guide (Mac Mini / Self-Hosted)

> Production deployment on Mac Mini with PM2 + Caddy + SSL

---

## Prerequisites

```bash
# Node.js 20+
node --version

# PM2 (process manager)
npm install -g pm2

# Caddy (reverse proxy + auto SSL)
brew install caddy

# sqlite3 CLI (for backups)
brew install sqlite3
```

---

## 1. First Deploy

### Clone & install

```bash
git clone <repo-url> /opt/one21
cd /opt/one21
npm install --production
```

### Configure environment

```bash
cp .env.production .env
# Edit .env and fill in all CHANGE_ME values:
nano .env
```

**Generate strong JWT secret:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Generate VAPID keys (push notifications):**
```bash
node -e "const wp=require('web-push');const k=wp.generateVAPIDKeys();console.log(JSON.stringify(k,null,2))"
```

### Set up directories

```bash
mkdir -p /opt/one21/uploads /opt/one21/logs /opt/one21/backups
chmod 750 /opt/one21/uploads
```

### Configure Caddy

Edit `Caddyfile` and replace `one21.yourdomain.com` with your domain.

```bash
# Test config
caddy validate --config /opt/one21/Caddyfile

# Start Caddy
sudo caddy start --config /opt/one21/Caddyfile
```

### Start app with PM2

```bash
cd /opt/one21
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup  # Follow the printed command to auto-start on boot
```

---

## 2. Domain & DNS

In your DNS provider, point your domain to your Mac Mini's public IP:

```
A  one21.yourdomain.com  →  <YOUR_PUBLIC_IP>
```

**Router port forwarding:**
| External Port | Internal Port | Protocol | Description |
|---------------|---------------|----------|-------------|
| 80  | 80  | TCP | Caddy (HTTP → HTTPS redirect) |
| 443 | 443 | TCP | Caddy (HTTPS + auto SSL) |

Caddy handles Let's Encrypt SSL automatically.

---

## 3. Updates (Zero-Downtime)

```bash
cd /opt/one21
git pull
npm install --production
pm2 reload one21  # graceful reload, no downtime
```

---

## 4. Backup Setup

```bash
# Test backup manually
./scripts/backup.sh

# Add to crontab (daily at 3am)
crontab -e
# Add line:
# 0 3 * * * /opt/one21/scripts/backup.sh >> /opt/one21/logs/backup.log 2>&1
```

Backups are stored in `/opt/one21/backups/`:
- `daily/` — last 30 days
- `weekly/` — last 4 weeks (every Sunday)

---

## 5. PM2 Commands

```bash
pm2 status              # Check app status
pm2 logs one21          # View live logs
pm2 logs one21 --lines 100  # Last 100 lines
pm2 restart one21       # Hard restart
pm2 reload one21        # Graceful reload (zero downtime)
pm2 monit               # Real-time monitoring dashboard
```

---

## 6. Health Check

```bash
curl https://one21.yourdomain.com/health
# Expected: {"status":"ok","uptime":...}
```

---

## 7. Caddy Commands

```bash
sudo caddy reload --config /opt/one21/Caddyfile   # Reload config
sudo caddy stop                                     # Stop Caddy
sudo journalctl -u caddy -f                        # Logs (if systemd)
tail -f /var/log/caddy/one21.log                   # Access logs
```

---

## 8. Monitoring

PM2 provides basic monitoring. For more detail:

```bash
# CPU/RAM usage
pm2 monit

# Check DB size
ls -lh /opt/one21/db/chat.db

# Check uploads size
du -sh /opt/one21/uploads/
```

---

## 9. Security Checklist

- [ ] Strong `JWT_SECRET` (64+ random bytes)
- [ ] Strong `AGENT_API_KEY` (32+ random chars)
- [ ] Fresh VAPID keys (not the dev keys)
- [ ] `ALLOWED_ORIGINS` set to your domain only
- [ ] `.env` permissions: `chmod 600 .env`
- [ ] `uploads/` not world-readable: `chmod 750 uploads/`
- [ ] Default admin password changed after first login
- [ ] Firewall: only ports 80, 443 exposed externally
- [ ] SSH key-only auth (no password SSH)

---

## 10. Troubleshooting

**App won't start:**
```bash
pm2 logs one21 --lines 50
node server.js  # Run directly to see errors
```

**SSL not working:**
```bash
caddy validate --config Caddyfile
# Ensure ports 80/443 are forwarded and domain DNS is correct
```

**DB locked:**
```bash
# Check for stuck processes
lsof /opt/one21/db/chat.db
pm2 restart one21
```

**Push notifications not working:**
- Verify VAPID keys are set correctly in `.env`
- HTTPS is required for push (won't work on HTTP)
- Check browser console for SW registration errors
