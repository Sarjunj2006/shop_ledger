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

## Owner access
Only the **New Entry** tab is visible to staff. **Today's Book**, **Reports**, and **Staff &
Services** are locked — clicking "Owner Login" (top right) prompts for a password, and only
after that does the owner see those tabs.

The default password is `owner123`. **Change it before using this in your shop.** Set your own
password with an environment variable when starting the server:

```bash
# Windows PowerShell
$env:OWNER_PASSWORD="owner123"; npm start

# macOS/Linux
OWNER_PASSWORD="owner123" npm start
```

Owner access lasts for that browser tab's session (closing the browser or clicking "Log out of
owner view" clears it); each device/browser needs to log in separately.

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
