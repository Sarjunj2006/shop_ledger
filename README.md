# Shop Ledger

A digital replacement for the counter notebook: staff log each service they finish (who did it,
what it was, how much, how it was paid), and the owner gets a live dashboard and reports instead
of a stack of handwritten pages.

## What's inside
- **Backend**: Node.js + Express, storing data in **Postgres** (works great with [Neon's](https://neon.tech)
  free tier — see setup below). No file-based storage, so nothing gets lost when the server
  restarts or redeploys.
- **Frontend**: plain HTML/CSS/JS (no build step) served by the same server.

## Setting up the database (Neon, free)

1. Sign up free at [neon.tech](https://neon.tech) — no credit card needed.
2. Create a new project (Neon calls the default database `neondb`, that's fine to keep).
3. On your project's dashboard, find the **connection string** — it looks like:
   ```
   postgresql://user:password@ep-something.region.aws.neon.tech/neondb?sslmode=require
   ```
   Copy the whole thing.
4. Set it as an environment variable named `DATABASE_URL` — locally in your terminal, or on
   Render under **Environment** (see the deploy steps further down).

That's it — no manual SQL needed. The first time the server starts with `DATABASE_URL` set, it
automatically creates all the tables and seeds the default staff/services if they're empty.

## Running it

1. Install [Node.js](https://nodejs.org) (v18 or newer) if you don't have it.
2. In this folder, run:
   ```bash
   npm install
   ```
3. Set your Neon connection string (see above), then start the server:
   ```bash
   # Windows PowerShell
   $env:DATABASE_URL="postgresql://your-neon-connection-string"; npm start

   # macOS/Linux
   DATABASE_URL="postgresql://your-neon-connection-string" npm start
   ```
4. Open **http://localhost:3000** in a browser. On a shop counter, open it on the tablet/laptop
   you keep at the till, or on any device connected to the same network as the computer running
   the server (use that computer's local IP instead of `localhost`, e.g. `http://192.168.1.5:3000`).

The app keeps running as long as the terminal/server is running. To keep it running permanently on
a shop computer, look into a process manager like `pm2` (`npm install -g pm2` then `pm2 start server.js`).

## Forgot password
Both logins support "Forgot password?":
1. The owner sets a **recovery email** once, from **Staff & Services → Recovery Email**. This one
   email is used for resetting *both* the owner password and the shared staff password — staff
   don't have individual emails, so a reset there also goes to the owner's inbox.
2. On the login screen, click "Forgot password?" under the password field, enter that email, and
   a 6-digit code is sent to it (valid 15 minutes).
3. Enter the code plus a new password to finish the reset.

**To actually receive the email**, you have two options:

### Option A — Resend (recommended if you're on Render's free tier)
Render's free tier **blocks outbound SMTP** (ports 25, 465, 587) entirely as an anti-spam
measure — so Gmail/SMTP will always time out there, no matter how correctly it's configured.
[Resend](https://resend.com) sends over plain HTTPS instead, which Render's free tier does
**not** block.

1. Sign up free at [resend.com](https://resend.com) (100 emails/day, 3,000/month free — plenty
   for this).
2. Grab an API key from their dashboard.
3. Set this one environment variable:
   ```
   RESEND_API_KEY=re_your_key_here
   ```
4. Optionally set `RESEND_FROM` to a custom "from" address once you've verified a domain with
   Resend; otherwise it defaults to Resend's own shared sending address, which works fine for
   getting started.

### Option B — SMTP (fine on a paid Render instance, your own VPS, etc.)
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=youraddress@gmail.com
SMTP_PASS=your-16-character-app-password
SMTP_FROM=youraddress@gmail.com
```
(For Gmail, use an ["App Password"](https://myaccount.google.com/apppasswords), not your normal
login password.) **This will time out on Render's free tier** — use Option A there instead.

If both `RESEND_API_KEY` and SMTP variables are set, Resend is used first.

**If neither is configured yet**, the reset code is still generated and printed to the server's
own console/logs (on Render: the **Logs** tab) instead of emailed — handy while you're still
setting things up.

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
   - `DATABASE_URL` → your Neon connection string (see "Setting up the database" above) — this
     is what makes your data actually persist, since Render's own local storage does not, even
     on the free tier.
   - `OWNER_PASSWORD` → your real owner password (don't leave it as `owner123`)
   - `STAFF_PASSWORD` → your real staff password (don't leave it as `staff123`)
   - Optionally, `RESEND_API_KEY` (or `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`)
     if you want "Forgot password" reset codes to actually arrive by email (see the Forgot
     Password section above). Without these, reset codes still work, just via the Render Logs
     tab instead of email.
5. Click **Create Web Service**. Render gives you a live URL like `https://shop-ledger.onrender.com`
   in a couple of minutes. The first startup automatically creates the database tables — nothing
   else to configure.

### 3. Using it day to day
Once deployed, share the Render URL with your staff (bookmark it on the shop tablet/phone) and
use `https://your-app.onrender.com` yourself for the owner view. The free tier "spins down" after
15 minutes of no traffic and takes ~30-50 seconds to wake back up on the next visit — worth
knowing so it doesn't feel broken the first time someone opens it in the morning. This no longer
affects your data though — with Neon handling storage, everything survives spin-downs, restarts,
and redeploys. A paid Render instance additionally stays always-on with no wake-up delay, but
that's a performance choice now, not a data-safety one.

## How staff use it
- **New Entry** tab: pick your name, pick the service (price fills in automatically, but you can
  edit it — useful for discounts or add-ons), pick how the customer paid, optionally add the
  customer's name or a note, and hit **Submit**. Takes a few seconds per customer.

## How the owner uses it
- **Today's Book**: everything logged today, in order, with a running total. Any entry can be
  removed if it was a mistake. Click **Refresh** to pull the latest entries — the page doesn't
  auto-update, so use this if you're watching it live or checking after a break.
- **Reports**: pick a date range and see total collected, broken down by staff (great for working
  out commission/payout), by payment method (cash vs card vs UPI — useful for reconciling the
  till), and by service (which services actually sell). **Export CSV** downloads the raw rows for
  that range, ready for Excel or your accountant.
- **Staff & Services**: add or remove staff members, and manage your price list. Changing a
  price here only affects new entries — past entries keep the price that was charged at the time.
- **Settings**: set the recovery email used for "Forgot password" (staff login only — see above).

## Data & backup
All data lives in your Neon Postgres database — it survives restarts and redeploys on its own, so
day-to-day you don't need to think about it. For extra safety (accidental deletion, wanting an
offline copy), Neon's dashboard has a SQL editor where you can run `SELECT * FROM entries;` etc.
to export data, or use `pg_dump` from the command line if you're comfortable with that. Neon also
keeps automatic backups on its own.

## Notes on extending this
Some natural next steps if you want to grow this later:
- **Login per staff member** (currently anyone can pick any name from the dropdown — fine for a
  small trusted team, but add PIN codes if that's a concern).
- **Commission %** per staff member, so the report shows payout amount directly, not just totals.
- **Multiple branches**, by tagging entries with a shop/branch ID.
