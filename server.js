// Shop Ledger — backend
// Express API backed by Postgres (works great with Neon's free tier — see README).

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- database connection ----------
if (!process.env.DATABASE_URL) {
  console.error("[Shop Ledger] DATABASE_URL is not set. Set it to your Postgres/Neon connection string.");
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

// ---------- password hashing (no external deps — Node's built-in scrypt) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(check, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function id(prefix) {
  return prefix + "_" + crypto.randomBytes(4).toString("hex");
}

// ---------- schema setup + seed data (runs once at startup, safe to run every time) ----------
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff (
      seq SERIAL,
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS services (
      seq SERIAL,
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price NUMERIC NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL,
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      price NUMERIC NOT NULL,
      payment_method TEXT NOT NULL,
      customer_name TEXT DEFAULT '',
      note TEXT DEFAULT '',
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      owner_email TEXT DEFAULT '',
      owner_password_hash TEXT,
      staff_password_hash TEXT
    );
  `);

  const { rows: staffRows } = await pool.query("SELECT COUNT(*) FROM staff");
  if (Number(staffRows[0].count) === 0) {
    await pool.query(
      `INSERT INTO staff (id, name, active) VALUES
       ('s1', 'Ravi', true), ('s2', 'Kumar', true), ('s3', 'Priya', true)`
    );
  }

  const { rows: serviceRows } = await pool.query("SELECT COUNT(*) FROM services");
  if (Number(serviceRows[0].count) === 0) {
    await pool.query(
      `INSERT INTO services (id, name, price) VALUES
       ('sv1', 'Haircut', 150), ('sv2', 'Beard Trim', 80), ('sv3', 'Hair Colour', 400),
       ('sv4', 'Facial', 350), ('sv5', 'Head Massage', 120)`
    );
  }

  const { rows: settingsRows } = await pool.query("SELECT * FROM settings WHERE id = 1");
  if (settingsRows.length === 0) {
    await pool.query(
      `INSERT INTO settings (id, owner_email, owner_password_hash, staff_password_hash)
       VALUES (1, $1, $2, $3)`,
      [
        process.env.OWNER_EMAIL || "",
        hashPassword(process.env.OWNER_PASSWORD || "owner123"),
        hashPassword(process.env.STAFF_PASSWORD || "staff123"),
      ]
    );
  }
  console.log("[Shop Ledger] Database ready.");
}

// ---------- email sending (for password-reset codes) ----------
// Two ways to actually send emails — pick whichever fits your host:
//
// Option A (recommended on Render): RESEND_API_KEY — sends over plain HTTPS, which Render's
// free tier does NOT block (unlike SMTP ports 25/465/587, which Render's free tier blocks
// outright as an anti-spam measure). Sign up free at https://resend.com, verify a sending
// domain or use their default, and set RESEND_API_KEY (and optionally RESEND_FROM).
//
// Option B (SMTP): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM — works fine on a
// paid Render instance, your own VPS, or any host that doesn't block SMTP ports.
//
// If neither is set, reset codes still work — they just print to these server logs instead.
let mailer = null;
if (process.env.SMTP_HOST) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}
if (process.env.RESEND_API_KEY) {
  console.log("[Shop Ledger] Email sending via Resend API (HTTPS) is configured.");
} else if (process.env.SMTP_HOST) {
  console.log(`[Shop Ledger] Email sending via SMTP configured: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}, user=${process.env.SMTP_USER || "(none)"}. Note: this will time out on Render's free tier, which blocks outbound SMTP — use RESEND_API_KEY instead if you're on Render free tier.`);
} else {
  console.log("[Shop Ledger] No email sending configured (set RESEND_API_KEY, or SMTP_HOST for SMTP) — reset codes will only appear in these logs.");
}

async function sendViaResend(to, code, label) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "Shop Ledger <onboarding@resend.dev>",
      to: [to],
      subject: `Shop Ledger — ${label} password reset code`,
      text: `Your ${label.toLowerCase()} password reset code is: ${code}\n\nThis code expires in 15 minutes. If you didn't request this, you can ignore this email.`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API returned ${res.status}: ${body}`);
  }
}

async function sendResetCodeEmail(to, code, label) {
  console.log(`[Shop Ledger] ${label} password reset code for ${to}: ${code} (valid 15 minutes)`);
  if (process.env.RESEND_API_KEY) {
    try {
      await sendViaResend(to, code, label);
      console.log(`[Shop Ledger] Reset email sent successfully to ${to} via Resend.`);
      return true;
    } catch (err) {
      console.error("[Shop Ledger] Failed to send reset email via Resend:", err.message);
      return false;
    }
  }
  if (mailer) {
    try {
      await mailer.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject: `Shop Ledger — ${label} password reset code`,
        text: `Your ${label.toLowerCase()} password reset code is: ${code}\n\nThis code expires in 15 minutes. If you didn't request this, you can ignore this email.`,
      });
      console.log(`[Shop Ledger] Reset email sent successfully to ${to} via SMTP.`);
      return true;
    } catch (err) {
      console.error("[Shop Ledger] Failed to send reset email via SMTP:", err.message);
      return false;
    }
  }
  console.log("[Shop Ledger] No email sending method configured — code above is log-only.");
  return false;
}

// ---------- reset codes (in-memory, short-lived) ----------
const resetCodes = new Map(); // code -> { type: "owner"|"staff", expiresAt }
function makeResetCode(type) {
  const code = String(crypto.randomInt(100000, 1000000)); // 6 digits
  resetCodes.set(code, { type, expiresAt: Date.now() + 15 * 60 * 1000 });
  return code;
}
function consumeResetCode(code, type) {
  const entry = resetCodes.get(code);
  if (!entry || entry.type !== type || entry.expiresAt < Date.now()) return false;
  resetCodes.delete(code);
  return true;
}

// ---------- owner access ----------
const ownerTokens = new Set();

app.post("/api/owner/login", async (req, res) => {
  const { password } = req.body;
  const { rows } = await pool.query("SELECT owner_password_hash FROM settings WHERE id = 1");
  if (!verifyPassword(password || "", rows[0]?.owner_password_hash)) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  const token = crypto.randomBytes(24).toString("hex");
  ownerTokens.add(token);
  res.json({ token });
});

app.post("/api/owner/logout", (req, res) => {
  const token = req.headers["x-owner-token"];
  if (token) ownerTokens.delete(token);
  res.status(204).end();
});

function requireOwner(req, res, next) {
  const token = req.headers["x-owner-token"];
  if (!token || !ownerTokens.has(token)) {
    return res.status(401).json({ error: "Owner access required." });
  }
  next();
}

// Note: the owner password has no email-based recovery by design — only the shared staff
// password does (see /api/staff-access/forgot-password below). If the owner password is lost,
// it can only be reset by running an UPDATE on the settings table directly in Neon's SQL editor.

// ---------- staff access (one shared password for the whole team) ----------
const staffTokens = new Set();

app.post("/api/staff-access/login", async (req, res) => {
  const { password } = req.body;
  const { rows } = await pool.query("SELECT staff_password_hash FROM settings WHERE id = 1");
  if (!verifyPassword(password || "", rows[0]?.staff_password_hash)) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  const token = crypto.randomBytes(24).toString("hex");
  staffTokens.add(token);
  res.json({ token });
});

app.post("/api/staff-access/logout", (req, res) => {
  const token = req.headers["x-staff-token"];
  if (token) staffTokens.delete(token);
  res.status(204).end();
});

function requireStaff(req, res, next) {
  const token = req.headers["x-staff-token"];
  if (!token || !staffTokens.has(token)) {
    return res.status(401).json({ error: "Staff access required." });
  }
  next();
}

app.post("/api/staff-access/forgot-password", async (req, res) => {
  const { email } = req.body;
  const { rows } = await pool.query("SELECT owner_email FROM settings WHERE id = 1");
  const registered = rows[0]?.owner_email;
  if (!registered) {
    return res.status(400).json({ error: "No recovery email is set up yet. Ask the owner to set one from Settings." });
  }
  if (email && email.trim().toLowerCase() === registered.toLowerCase()) {
    const code = makeResetCode("staff");
    await sendResetCodeEmail(registered, code, "Staff");
  }
  res.json({ message: "If that email is on file, a reset code has been sent." });
});

app.post("/api/staff-access/reset-password", async (req, res) => {
  const { code, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "New password must be at least 4 characters." });
  }
  if (!consumeResetCode(code, "staff")) {
    return res.status(400).json({ error: "That code is invalid or has expired." });
  }
  await pool.query("UPDATE settings SET staff_password_hash = $1 WHERE id = 1", [hashPassword(newPassword)]);
  staffTokens.clear();
  res.json({ message: "Staff password updated." });
});

// ---------- owner settings (recovery email) ----------
app.get("/api/settings", requireOwner, async (req, res) => {
  const { rows } = await pool.query("SELECT owner_email FROM settings WHERE id = 1");
  res.json({ ownerEmail: rows[0]?.owner_email || "" });
});

app.patch("/api/settings", requireOwner, async (req, res) => {
  const { ownerEmail } = req.body;
  if (typeof ownerEmail !== "string" || !/^\S+@\S+\.\S+$/.test(ownerEmail)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  await pool.query("UPDATE settings SET owner_email = $1 WHERE id = 1", [ownerEmail.trim()]);
  res.json({ ownerEmail: ownerEmail.trim() });
});

// ---------- staff ----------
app.get("/api/staff", async (req, res) => {
  const { rows } = await pool.query("SELECT id, name, active FROM staff ORDER BY seq");
  res.json(rows);
});

app.post("/api/staff", requireOwner, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  const newId = id("s");
  const { rows } = await pool.query(
    "INSERT INTO staff (id, name, active) VALUES ($1, $2, true) RETURNING id, name, active",
    [newId, name.trim()]
  );
  res.status(201).json(rows[0]);
});

app.patch("/api/staff/:id", requireOwner, async (req, res) => {
  const { rows: existingRows } = await pool.query("SELECT * FROM staff WHERE id = $1", [req.params.id]);
  if (existingRows.length === 0) return res.status(404).json({ error: "Staff member not found." });
  const name = typeof req.body.name === "string" ? req.body.name.trim() : existingRows[0].name;
  const active = typeof req.body.active === "boolean" ? req.body.active : existingRows[0].active;
  const { rows } = await pool.query(
    "UPDATE staff SET name = $1, active = $2 WHERE id = $3 RETURNING id, name, active",
    [name, active, req.params.id]
  );
  res.json(rows[0]);
});

app.delete("/api/staff/:id", requireOwner, async (req, res) => {
  const { rowCount } = await pool.query("DELETE FROM staff WHERE id = $1", [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: "Staff member not found." });
  res.status(204).end();
});

// ---------- services ----------
app.get("/api/services", async (req, res) => {
  const { rows } = await pool.query("SELECT id, name, price FROM services ORDER BY seq");
  res.json(rows.map((r) => ({ ...r, price: Number(r.price) })));
});

app.post("/api/services", requireOwner, async (req, res) => {
  const { name, price } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Service name is required." });
  if (typeof price !== "number" || price < 0) return res.status(400).json({ error: "Price must be a non-negative number." });
  const newId = id("sv");
  const { rows } = await pool.query(
    "INSERT INTO services (id, name, price) VALUES ($1, $2, $3) RETURNING id, name, price",
    [newId, name.trim(), price]
  );
  res.status(201).json({ ...rows[0], price: Number(rows[0].price) });
});

app.patch("/api/services/:id", requireOwner, async (req, res) => {
  const { rows: existingRows } = await pool.query("SELECT * FROM services WHERE id = $1", [req.params.id]);
  if (existingRows.length === 0) return res.status(404).json({ error: "Service not found." });
  const name = typeof req.body.name === "string" ? req.body.name.trim() : existingRows[0].name;
  const price = typeof req.body.price === "number" ? req.body.price : Number(existingRows[0].price);
  const { rows } = await pool.query(
    "UPDATE services SET name = $1, price = $2 WHERE id = $3 RETURNING id, name, price",
    [name, price, req.params.id]
  );
  res.json({ ...rows[0], price: Number(rows[0].price) });
});

app.delete("/api/services/:id", requireOwner, async (req, res) => {
  const { rowCount } = await pool.query("DELETE FROM services WHERE id = $1", [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: "Service not found." });
  res.status(204).end();
});

// ---------- entries (the actual "notebook" rows) ----------
function rowToEntry(r) {
  return {
    id: r.id,
    staffId: r.staff_id,
    staffName: r.staff_name,
    serviceId: r.service_id,
    serviceName: r.service_name,
    price: Number(r.price),
    paymentMethod: r.payment_method,
    customerName: r.customer_name || "",
    note: r.note || "",
    date: r.date,
    time: r.time,
    createdAt: r.created_at,
  };
}

app.get("/api/entries", requireOwner, async (req, res) => {
  const { date, staffId, from, to } = req.query;
  const conditions = [];
  const params = [];
  if (date) {
    params.push(date);
    conditions.push(`date = $${params.length}`);
  }
  if (staffId) {
    params.push(staffId);
    conditions.push(`staff_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`date <= $${params.length}`);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const { rows } = await pool.query(`SELECT * FROM entries ${where} ORDER BY created_at DESC`, params);
  res.json(rows.map(rowToEntry));
});

app.post("/api/entries", requireStaff, async (req, res) => {
  const { staffId, serviceId, price, paymentMethod, customerName, note } = req.body;
  if (!staffId || !serviceId) return res.status(400).json({ error: "Staff and service are required." });
  if (typeof price !== "number" || price < 0) return res.status(400).json({ error: "Price must be a non-negative number." });
  const validMethods = ["cash", "card", "upi", "other"];
  if (!validMethods.includes(paymentMethod)) return res.status(400).json({ error: "Invalid payment method." });

  const { rows: staffRows } = await pool.query("SELECT * FROM staff WHERE id = $1", [staffId]);
  const { rows: serviceRows } = await pool.query("SELECT * FROM services WHERE id = $1", [serviceId]);
  if (staffRows.length === 0) return res.status(404).json({ error: "Staff member not found." });
  if (serviceRows.length === 0) return res.status(404).json({ error: "Service not found." });
  const staff = staffRows[0];
  const service = serviceRows[0];

  const now = new Date();
  const entry = {
    id: id("e"),
    staffId,
    staffName: staff.name,
    serviceId,
    serviceName: service.name,
    price,
    paymentMethod,
    customerName: customerName ? customerName.trim() : "",
    note: note ? note.trim() : "",
    date: now.toISOString().slice(0, 10), // YYYY-MM-DD, UTC
    time: now.toTimeString().slice(0, 5), // HH:MM
    createdAt: now.toISOString(),
  };
  await pool.query(
    `INSERT INTO entries (id, staff_id, staff_name, service_id, service_name, price, payment_method, customer_name, note, date, time, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      entry.id, entry.staffId, entry.staffName, entry.serviceId, entry.serviceName,
      entry.price, entry.paymentMethod, entry.customerName, entry.note,
      entry.date, entry.time, entry.createdAt,
    ]
  );
  res.status(201).json(entry);
});

app.delete("/api/entries/:id", requireOwner, async (req, res) => {
  const { rowCount } = await pool.query("DELETE FROM entries WHERE id = $1", [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: "Entry not found." });
  res.status(204).end();
});

// ---------- summary / reports ----------
app.get("/api/summary", requireOwner, async (req, res) => {
  const { from, to } = req.query;
  const conditions = [];
  const params = [];
  if (from) {
    params.push(from);
    conditions.push(`date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`date <= $${params.length}`);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const { rows } = await pool.query(`SELECT * FROM entries ${where}`, params);
  const entries = rows.map(rowToEntry);

  const total = entries.reduce((sum, e) => sum + e.price, 0);
  const byStaff = {};
  const byPayment = { cash: 0, card: 0, upi: 0, other: 0 };
  const byService = {};

  for (const e of entries) {
    byStaff[e.staffName] = byStaff[e.staffName] || { count: 0, total: 0 };
    byStaff[e.staffName].count += 1;
    byStaff[e.staffName].total += e.price;

    byPayment[e.paymentMethod] = (byPayment[e.paymentMethod] || 0) + e.price;

    byService[e.serviceName] = byService[e.serviceName] || { count: 0, total: 0 };
    byService[e.serviceName].count += 1;
    byService[e.serviceName].total += e.price;
  }

  res.json({
    count: entries.length,
    total,
    byStaff,
    byPayment,
    byService,
  });
});

const PORT = process.env.PORT || 3000;
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Shop Ledger running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("[Shop Ledger] Failed to initialize database:", err.message);
    process.exit(1);
  });
