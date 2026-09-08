// Shop Ledger — backend
// A tiny Express API backed by a JSON file (data/db.json).
// No native modules, no database server to install — just `npm install && npm start`.

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "db.json");
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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

// Create the data file (and its folder) if it doesn't exist yet — matters on a fresh
// deploy or a fresh Render Disk mount, which starts out empty.
function ensureDB() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const seed = {
      staff: [
        { id: "s1", name: "Ravi", active: true },
        { id: "s2", name: "Kumar", active: true },
        { id: "s3", name: "Priya", active: true },
      ],
      services: [
        { id: "sv1", name: "Haircut", price: 150 },
        { id: "sv2", name: "Beard Trim", price: 80 },
        { id: "sv3", name: "Hair Colour", price: 400 },
        { id: "sv4", name: "Facial", price: 350 },
        { id: "sv5", name: "Head Massage", price: 120 },
      ],
      entries: [],
      settings: {
        ownerEmail: process.env.OWNER_EMAIL || "",
        ownerPasswordHash: hashPassword(process.env.OWNER_PASSWORD || "owner123"),
        staffPasswordHash: hashPassword(process.env.STAFF_PASSWORD || "staff123"),
      },
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2));
  }
}
ensureDB();

// ---------- tiny file-backed "database" ----------
function readDB() {
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  const db = JSON.parse(raw);
  // Back-fill settings for databases created before this feature existed.
  if (!db.settings) {
    db.settings = {
      ownerEmail: process.env.OWNER_EMAIL || "",
      ownerPasswordHash: hashPassword(process.env.OWNER_PASSWORD || "owner123"),
      staffPasswordHash: hashPassword(process.env.STAFF_PASSWORD || "staff123"),
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  }
  return db;
}
function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function id(prefix) {
  return prefix + "_" + crypto.randomBytes(4).toString("hex");
}

// ---------- email sending (for password-reset codes) ----------
// Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (and optionally SMTP_FROM) to actually
// send reset codes by email. Works with Gmail (an "app password"), SendGrid, Mailgun, etc.
let mailer = null;
if (process.env.SMTP_HOST) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}
async function sendResetCodeEmail(to, code, label) {
  // Always log server-side too — useful during setup, and as a fallback if SMTP isn't configured yet.
  console.log(`[Shop Ledger] ${label} password reset code for ${to}: ${code} (valid 15 minutes)`);
  if (!mailer) return false;
  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: `Shop Ledger — ${label} password reset code`,
      text: `Your ${label.toLowerCase()} password reset code is: ${code}\n\nThis code expires in 15 minutes. If you didn't request this, you can ignore this email.`,
    });
    return true;
  } catch (err) {
    console.error("[Shop Ledger] Failed to send reset email:", err.message);
    return false;
  }
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

app.post("/api/owner/login", (req, res) => {
  const { password } = req.body;
  const db = readDB();
  if (!verifyPassword(password || "", db.settings.ownerPasswordHash)) {
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

app.post("/api/owner/forgot-password", async (req, res) => {
  const { email } = req.body;
  const db = readDB();
  const registered = db.settings.ownerEmail;
  if (!registered) {
    return res.status(400).json({ error: "No recovery email is set up yet. Set one from Staff & Services while logged in as owner." });
  }
  // Respond the same way whether or not it matches, so this can't be used to probe for the registered address.
  if (email && email.trim().toLowerCase() === registered.toLowerCase()) {
    const code = makeResetCode("owner");
    await sendResetCodeEmail(registered, code, "Owner");
  }
  res.json({ message: "If that email is on file, a reset code has been sent." });
});

app.post("/api/owner/reset-password", (req, res) => {
  const { code, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "New password must be at least 4 characters." });
  }
  if (!consumeResetCode(code, "owner")) {
    return res.status(400).json({ error: "That code is invalid or has expired." });
  }
  const db = readDB();
  db.settings.ownerPasswordHash = hashPassword(newPassword);
  writeDB(db);
  ownerTokens.clear(); // force re-login everywhere after a password change
  res.json({ message: "Owner password updated." });
});

// ---------- staff access (one shared password for the whole team) ----------
const staffTokens = new Set();

app.post("/api/staff-access/login", (req, res) => {
  const { password } = req.body;
  const db = readDB();
  if (!verifyPassword(password || "", db.settings.staffPasswordHash)) {
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
  const db = readDB();
  const registered = db.settings.ownerEmail;
  if (!registered) {
    return res.status(400).json({ error: "No recovery email is set up yet. Ask the owner to set one from Staff & Services." });
  }
  if (email && email.trim().toLowerCase() === registered.toLowerCase()) {
    const code = makeResetCode("staff");
    await sendResetCodeEmail(registered, code, "Staff");
  }
  res.json({ message: "If that email is on file, a reset code has been sent." });
});

app.post("/api/staff-access/reset-password", (req, res) => {
  const { code, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "New password must be at least 4 characters." });
  }
  if (!consumeResetCode(code, "staff")) {
    return res.status(400).json({ error: "That code is invalid or has expired." });
  }
  const db = readDB();
  db.settings.staffPasswordHash = hashPassword(newPassword);
  writeDB(db);
  staffTokens.clear();
  res.json({ message: "Staff password updated." });
});

// ---------- owner settings (recovery email) ----------
app.get("/api/settings", requireOwner, (req, res) => {
  const db = readDB();
  res.json({ ownerEmail: db.settings.ownerEmail || "" });
});

app.patch("/api/settings", requireOwner, (req, res) => {
  const { ownerEmail } = req.body;
  if (typeof ownerEmail !== "string" || !/^\S+@\S+\.\S+$/.test(ownerEmail)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  const db = readDB();
  db.settings.ownerEmail = ownerEmail.trim();
  writeDB(db);
  res.json({ ownerEmail: db.settings.ownerEmail });
});

// ---------- staff ----------
app.get("/api/staff", (req, res) => {
  const db = readDB();
  res.json(db.staff);
});

app.post("/api/staff", requireOwner, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  const db = readDB();
  const member = { id: id("s"), name: name.trim(), active: true };
  db.staff.push(member);
  writeDB(db);
  res.status(201).json(member);
});

app.patch("/api/staff/:id", requireOwner, (req, res) => {
  const db = readDB();
  const member = db.staff.find((s) => s.id === req.params.id);
  if (!member) return res.status(404).json({ error: "Staff member not found." });
  if (typeof req.body.name === "string") member.name = req.body.name.trim();
  if (typeof req.body.active === "boolean") member.active = req.body.active;
  writeDB(db);
  res.json(member);
});

app.delete("/api/staff/:id", requireOwner, (req, res) => {
  const db = readDB();
  const before = db.staff.length;
  db.staff = db.staff.filter((s) => s.id !== req.params.id);
  if (db.staff.length === before) return res.status(404).json({ error: "Staff member not found." });
  writeDB(db);
  res.status(204).end();
});

// ---------- services ----------
app.get("/api/services", (req, res) => {
  const db = readDB();
  res.json(db.services);
});

app.post("/api/services", requireOwner, (req, res) => {
  const { name, price } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Service name is required." });
  if (typeof price !== "number" || price < 0) return res.status(400).json({ error: "Price must be a non-negative number." });
  const db = readDB();
  const service = { id: id("sv"), name: name.trim(), price };
  db.services.push(service);
  writeDB(db);
  res.status(201).json(service);
});

app.patch("/api/services/:id", requireOwner, (req, res) => {
  const db = readDB();
  const service = db.services.find((s) => s.id === req.params.id);
  if (!service) return res.status(404).json({ error: "Service not found." });
  if (typeof req.body.name === "string") service.name = req.body.name.trim();
  if (typeof req.body.price === "number") service.price = req.body.price;
  writeDB(db);
  res.json(service);
});

app.delete("/api/services/:id", requireOwner, (req, res) => {
  const db = readDB();
  const before = db.services.length;
  db.services = db.services.filter((s) => s.id !== req.params.id);
  if (db.services.length === before) return res.status(404).json({ error: "Service not found." });
  writeDB(db);
  res.status(204).end();
});

// ---------- entries (the actual "notebook" rows) ----------
app.get("/api/entries", requireOwner, (req, res) => {
  const db = readDB();
  let entries = db.entries;
  const { date, staffId, from, to } = req.query;
  if (date) entries = entries.filter((e) => e.date === date);
  if (staffId) entries = entries.filter((e) => e.staffId === staffId);
  if (from) entries = entries.filter((e) => e.date >= from);
  if (to) entries = entries.filter((e) => e.date <= to);
  entries = [...entries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json(entries);
});

app.post("/api/entries", requireStaff, (req, res) => {
  const { staffId, serviceId, price, paymentMethod, customerName, note } = req.body;
  if (!staffId || !serviceId) return res.status(400).json({ error: "Staff and service are required." });
  if (typeof price !== "number" || price < 0) return res.status(400).json({ error: "Price must be a non-negative number." });
  const validMethods = ["cash", "card", "upi", "other"];
  if (!validMethods.includes(paymentMethod)) return res.status(400).json({ error: "Invalid payment method." });

  const db = readDB();
  const staff = db.staff.find((s) => s.id === staffId);
  const service = db.services.find((s) => s.id === serviceId);
  if (!staff) return res.status(404).json({ error: "Staff member not found." });
  if (!service) return res.status(404).json({ error: "Service not found." });

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
    date: now.toISOString().slice(0, 10), // YYYY-MM-DD, local server date
    time: now.toTimeString().slice(0, 5), // HH:MM
    createdAt: now.toISOString(),
  };
  db.entries.push(entry);
  writeDB(db);
  res.status(201).json(entry);
});

app.delete("/api/entries/:id", requireOwner, (req, res) => {
  const db = readDB();
  const before = db.entries.length;
  db.entries = db.entries.filter((e) => e.id !== req.params.id);
  if (db.entries.length === before) return res.status(404).json({ error: "Entry not found." });
  writeDB(db);
  res.status(204).end();
});

// ---------- summary / reports ----------
app.get("/api/summary", requireOwner, (req, res) => {
  const db = readDB();
  const { from, to } = req.query;
  let entries = db.entries;
  if (from) entries = entries.filter((e) => e.date >= from);
  if (to) entries = entries.filter((e) => e.date <= to);

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
app.listen(PORT, () => {
  console.log(`Shop Ledger running at http://localhost:${PORT}`);
});
