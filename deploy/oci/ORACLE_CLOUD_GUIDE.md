# Hosting Mail Track on Oracle Cloud (OCI Always Free Tier)

Running Mail Track on an Oracle Cloud Always Free Ubuntu VM gives you full persistence that serverless hosts (like Vercel) cannot provide:
- Real-time **`wss://` WebSocket push notifications** for instant email open/click alerts.
- Continuous **30-second Gmail Mobile Checkmark background sync** (`✓` / `✓✓`).
- Always-warm Node.js process (`node server/server.js`) with optional local SQLite (`better-sqlite3`) or your existing **Turso cloud database**.

> **Zero extension changes needed:** The Chrome extension already defaults to `https://mailtrack.in` and automatically upgrades WebSockets to `wss://mailtrack.in` once your DNS points to Oracle Cloud.

---

## Step 1: Create Your Oracle Cloud Always Free VM

1. Sign in to [Oracle Cloud Console](https://cloud.oracle.com/).
   - *Tip:* If your Turso database is in `aws-ap-south-1` (Mumbai), pick **India West (Mumbai) — `ap-mumbai-1`** for your OCI Home Region for lowest database latency.
2. Go to **Compute -> Instances -> Create Instance**.
3. Configure **Always Free-eligible** options:
   - **Image:** Canonical Ubuntu **24.04** (or 22.04).
   - **Shape (Best):** **Ampere `VM.Standard.A1.Flex`** (`ARM64`, Always Free up to 4 OCPUs + 24 GB RAM — **2 OCPU / 12 GB RAM** leaves room for a second free VM).
   - **Shape (Fallback if A1 capacity is full):** **`VM.Standard.E2.1.Micro`** (`x86_64`, 1 OCPU / 1 GB RAM — works cleanly too because `setup-oci.sh` creates a 2 GB swapfile).
4. Under **Networking**:
   - Ensure **Assign a public IPv4 address** is checked.
   - Reserve a static public IP (or note the ephemeral public IP under Instance Details -> Primary VNIC -> Public IP).
5. Under **Add SSH keys**, download/save the private key (or paste your `~/.ssh/id_ed25519.pub`), then click **Create**.

---

## Step 2: Open OCI Virtual Cloud Network (VCN) Firewall

*(Skip this step only if you choose **Method B: Cloudflare Named Tunnel** below.)*

1. Open your VM's **Instance Details -> Subnet -> Security List** (usually `Default Security List for vcn-...`).
2. Click **Add Ingress Rules** and add these two rules (keep existing port `22` for SSH):
   - **HTTP:** Source CIDR `0.0.0.0/0`, IP Protocol `TCP`, Destination Port Range `80`
   - **HTTPS:** Source CIDR `0.0.0.0/0`, IP Protocol `TCP`, Destination Port Range `443`

*(Note: Oracle Ubuntu images ALSO block ports 80/443 inside OS `iptables`. `deploy/oci/setup-oci.sh` automatically opens both persistently for you.)*

---

## Step 3: SSH In & Run the Bootstrap Script

From your local terminal:

```bash
ssh ubuntu@<YOUR_VM_PUBLIC_IP>
```

On the Oracle VM:

```bash
git clone https://github.com/Naveenkr1/MailTrack.git ~/mail-track
cd ~/mail-track
chmod +x deploy/oci/setup-oci.sh
sudo ./deploy/oci/setup-oci.sh
```

What `setup-oci.sh` configures automatically:
- 2 GB `/swapfile` (if not already present)
- Node.js 20 LTS, `pm2`, `caddy`, build tools (`build-essential`, `python3`)
- Persistent Ubuntu `iptables` rules allowing ports `80` & `443`
- Production `npm install --omit=dev`
- Starter `server/.env` (with auto-generated `JWT_SECRET` & `SESSION_SECRET`)
- Starts `mail-track` via [ecosystem.config.js](ecosystem.config.js) on boot

---

## Step 4: Configure `server/.env`

Edit `/home/ubuntu/mail-track/server/.env`:

```bash
nano ~/mail-track/server/.env
```

Fill in your production values (keeping your existing `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` so all existing users & tracked emails remain intact):

```dotenv
PORT=4000
NODE_ENV=production

# Keep generated secrets (or copy your existing JWT_SECRET so existing browser sessions stay valid)
JWT_SECRET=...
SESSION_SECRET=...

GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret

# Production canonical domain
BASE_URL=https://mailtrack.in

# Reverse proxy mode (Caddy handles HTTPS + wss:// directly on Oracle Cloud)
DISABLE_TUNNEL=true
ENABLE_QUICK_TUNNEL=false

# Keep Turso credentials to preserve existing production DB (leave blank to store locally in server/data/mailtrack.db)
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...

# MUST be false in production
ALLOW_DEV_LOGIN=false
```

Then restart PM2:

```bash
pm2 restart mail-track
curl -fsS http://127.0.0.1:4000/healthz
```

---

## Step 5: HTTPS & Domain Cutover

### Recommended: Zero-Downtime Pre-DNS Test with `sslip.io`

Before pointing `mailtrack.in` away from Vercel, verify HTTPS + OAuth + WebSockets using OCI's IP:

1. Temporarily set `BASE_URL=https://<YOUR_VM_PUBLIC_IP>.sslip.io` in `server/.env` and run `pm2 restart mail-track`.
2. Configure Caddy with the temporary domain:
   ```bash
   sudo ./deploy/oci/setup-oci.sh --domain <YOUR_VM_PUBLIC_IP>.sslip.io
   ```
3. Verify externally:
   ```bash
   curl -fsS https://<YOUR_VM_PUBLIC_IP>.sslip.io/healthz
   curl -fsS https://<YOUR_VM_PUBLIC_IP>.sslip.io/api/config
   ```
   Confirm `wsUrl` returns `"wss://<YOUR_VM_PUBLIC_IP>.sslip.io"`.

### Final Cutover to `mailtrack.in`

1. In your DNS provider (Cloudflare / Namecheap / GoDaddy):
   - Update `@` (`mailtrack.in`) `A` record -> `<YOUR_VM_PUBLIC_IP>`
   - Update `www` (`www.mailtrack.in`) `A` record (or `CNAME mailtrack.in`) -> `<YOUR_VM_PUBLIC_IP>`
   - *(If using Cloudflare DNS: temporarily set proxy to **DNS only / grey cloud** while Caddy obtains the initial Let's Encrypt cert, or enable Cloudflare **Full (strict)** SSL/TLS.)*
2. Set `BASE_URL=https://mailtrack.in` in `server/.env` and restart PM2:
   ```bash
   pm2 restart mail-track
   ```
3. Install the production Caddyfile:
   ```bash
   sudo cp ~/mail-track/deploy/oci/Caddyfile /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```
4. Verify [Google Cloud Console -> Credentials](https://console.cloud.google.com/apis/credentials) includes:
   - Authorized redirect URI: `https://mailtrack.in/auth/google/callback`
   - Authorized JavaScript origin: `https://mailtrack.in`

---

### Alternative (Method B): Cloudflare Named Tunnel (Zero Open Ports)

If you prefer not to open VCN ports 80/443 at all, you can point a Cloudflare Tunnel directly from the VM:

1. In `server/.env`, set:
   ```dotenv
   DISABLE_TUNNEL=false
   BASE_URL=https://mailtrack.in
   CUSTOM_DOMAIN=mailtrack.in
   CLOUDFLARE_TUNNEL_TOKEN=<your_cloudflare_tunnel_token>
   ```
2. Install `cloudflared` on Ubuntu or let Node spawn it, and point your Cloudflare Zero Trust Public Hostnames (`mailtrack.in` and `www.mailtrack.in`) to `http://127.0.0.1:4000`.
3. You can leave Caddy stopped (`sudo systemctl disable --now caddy`).

---

## Ongoing Operations

```bash
pm2 status                    # Check process status & uptime
pm2 logs mail-track --lines 50
pm2 restart mail-track        # Restart after editing server/.env or pulling updates
git pull && npm install --omit=dev && pm2 restart mail-track
sudo journalctl -u caddy -n 50 --no-pager
```
