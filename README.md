# Shop Ledger

A digital replacement for the counter notebook: staff log each service they finish (who did it,
what it was, how much, how it was paid), and the owner gets a live dashboard and reports instead
of a stack of handwritten pages.

## What's inside
- **Backend**: Node.js + Express, storing data in a plain JSON file (`data/db.json`) — no database
  server to install, easy to back up (it's just a file), easy to inspect.
- **Frontend**: plain HTML/CSS/JS (no build step) served by the same server.

## Running it

1. Install [Node.js](https://nodejs.org) (v18 or newer) if you don't have it.
2. In this folder, run:
   ```bash
   npm install
   npm start
   ```
3. Open **http://localhost:3000** in a browser. On a shop counter, open it on the tablet/laptop
   you keep at the till, or on any device connected to the same network as the computer running
   the server (use that computer's local IP instead of `localhost`, e.g. `http://192.168.1.5:3000`).

The app keeps running as long as the terminal/server is running. To keep it running permanently on
a shop computer, look into a process manager like `pm2` (`npm install -g pm2` then `pm2 start server.js`).

## Logging in
Everyone hits a login screen first, with two buttons:

- **Staff Login** — one shared password for the whole team. Any staff member enters it to reach
  **New Entry**, then still picks their own name from the "Who did the work" dropdown when they
  log each service (so the record is per-person even though the login itself is shared).
- **Owner Login** — a separate password that unlocks **Today's Book**, **Reports**, and
  **Staff & Services**.

Both default passwords are placeholders — **change them before real use**:
```bash
# Windows PowerShell
$env:STAFF_PASSWORD="your-staff-password"; $env:OWNER_PASSWORD="your-owner-password"; npm start

# macOS/Linux
STAFF_PASSWORD="your-staff-password" OWNER_PASSWORD="your-owner-password" npm start
```
Defaults if unset: `staff123` and `owner123`.

Each login lasts for that browser tab's session — closing the browser, or clicking the relevant
"Log out," clears it. Staff and owner sessions are independent, so an owner can log in to check
reports without disturbing a staff member's session on the same device, and vice versa.

## Deploying to Render

### 1. Push the code to GitHub
Render deploys from a Git repo, so this project needs to be in one.
```bash
cd shop-ledger
git init
git add .
git commit -m "Shop Ledger"
```
Create a new empty repo on GitHub, then:
```bash
git remote add origin https://github.com/<your-username>/shop-ledger.git
git branch -M main
git push -u origin main
```

### 2. Create the Web Service on Render
1. Go to [render.com](https://render.com) → **New +** → **Web Service**.
2. Connect your GitHub account and pick the `shop-ledger` repo.
3. Fill in:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Under **Environment Variables**, add:
   - `OWNER_PASSWORD` → your real owner password (don't leave it as `owner123`)
   - `STAFF_PASSWORD` → your real staff password (don't leave it as `staff123`)
5. Click **Create Web Service**. Render gives you a live URL like `https://shop-ledger.onrender.com`
   in a couple of minutes.

### 3. Make the data persist (important)
Without this step, Render wipes the app's local files on every restart/redeploy, so your logged
entries, staff, and services would disappear. To fix it:

1. On your service in Render, go to **Disks** → **Add Disk**.
   - Name: `shop-data`
   - Mount Path: `/var/data`
   - Size: 1 GB is plenty.
   - Note: persistent disks require a **paid instance type** (Starter or above) — the free tier
     does not support them.
2. Add another environment variable: `DB_PATH` → `/var/data/db.json`
3. Redeploy. The server will automatically create `db.json` with the default staff/services the
   first time it starts, and from then on all data is saved to the disk and survives restarts.

If you're just testing and don't mind the data resetting occasionally, you can skip the disk —
the app will still run fine on Render's free tier, it'll just lose entries whenever the service
restarts or redeploys.

### 4. Using it day to day
Once deployed, share the Render URL with your staff (bookmark it on the shop tablet/phone) and
use `https://your-app.onrender.com` yourself for the owner view. The free tier "spins down" after
15 minutes of no traffic and takes ~30-50 seconds to wake back up on the next visit — worth
knowing so it doesn't feel broken the first time someone opens it in the morning. A paid instance
stays always-on.

## How staff use it
- **New Entry** tab: pick your name, pick the service (price fills in automatically, but you can
  edit it — useful for discounts or add-ons), pick how the customer paid, optionally add the
  customer's name or a note, and hit **Log this service**. Takes a few seconds per customer.

## How the owner uses it
- **Today's Book**: everything logged today, in order, with a running total. Any entry can be
  removed if it was a mistake.
- **Reports**: pick a date range and see total collected, broken down by staff (great for working
  out commission/payout), by payment method (cash vs card vs UPI — useful for reconciling the
  till), and by service (which services actually sell). **Export CSV** downloads the raw rows for
  that range, ready for Excel or your accountant.
- **Staff & Services**: add or remove staff members, and manage your price list. Changing a
  price here only affects new entries — past entries keep the price that was charged at the time.

## Data & backup
All data lives in `data/db.json`. Back this file up regularly (copy it to a USB drive, cloud
folder, email it to yourself, etc.) — if the file is lost, the history is lost. It's plain
JSON, so it's easy to read or migrate to a real database later if the shop grows.

## Notes on extending this
Some natural next steps if you want to grow this later:
- **Login per staff member** (currently anyone can pick any name from the dropdown — fine for a
  small trusted team, but add PIN codes if that's a concern).
- **Commission %** per staff member, so the report shows payout amount directly, not just totals.
- **Multiple branches**, by tagging entries with a shop/branch ID.
- **A real database** (Postgres/MySQL) if the shop has many staff and years of history — the
  JSON-file approach is simple and works well up to a few hundred entries a day.
