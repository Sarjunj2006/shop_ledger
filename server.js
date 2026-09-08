// Shop Ledger — backend
// A tiny Express API backed by a JSON file (data/db.json).
// No native modules, no database server to install — just `npm install && npm start`.

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "db.json");
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Create the data file (and its folder) if it doesn't exist yet — matters on a fresh
// deploy or a fresh Render Disk mount, which starts out empty.
function ensureDB() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const seed = {
      staff: [
        { id: "s1", name: "Ravi", active: true, pin: "1111" },
        { id: "s2", name: "Kumar", active: true, pin: "2222" },
        { id: "s3", name: "Priya", active: true, pin: "3333" },
      ],
      services: [
        { id: "sv1", name: "Haircut", price: 150 },
        { id: "sv2", name: "Beard Trim", price: 80 },
        { id: "sv3", name: "Hair Colour", price: 400 },
        { id: "sv4", name: "Facial", price: 350 },
        { id: "sv5", name: "Head Massage", price: 120 },
      ],
      entries: [],
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2));
  }
}
ensureDB();

// ---------- owner access ----------
// Set a real password via the OWNER_PASSWORD environment variable before running in a real shop.
// Default is only here so it works out of the box — change it.
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "owner123";
const ownerTokens = new Set();

app.post("/api/owner/login", (req, res) => {
  const { password } = req.body;
  if (password !== OWNER_PASSWORD) {
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

// ---------- staff access (PIN login) ----------
const staffTokens = new Map(); // token -> staffId

app.post("/api/staff/login", (req, res) => {
  const { staffId, pin } = req.body;
  if (!staffId || !pin) return res.status(400).json({ error: "Select your name and enter your PIN." });
  const db = readDB();
  const staff = db.staff.find((s) => s.id === staffId && s.active);
  if (!staff || staff.pin !== String(pin)) {
    return res.status(401).json({ error: "That name and PIN don't match." });
  }
  const token = crypto.randomBytes(24).toString("hex");
  staffTokens.set(token, staff.id);
  res.json({ token, staffId: staff.id, staffName: staff.name });
});

app.post("/api/staff/logout", (req, res) => {
  const token = req.headers["x-staff-token"];
  if (token) staffTokens.delete(token);
  res.status(204).end();
});

function requireStaff(req, res, next) {
  const token = req.headers["x-staff-token"];
  const staffId = token && staffTokens.get(token);
  if (!staffId) {
    return res.status(401).json({ error: "Please log in again." });
  }
  req.staffId = staffId;
  next();
}

// ---------- tiny file-backed "database" ----------
function readDB() {
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}
function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function id(prefix) {
  return prefix + "_" + crypto.randomBytes(4).toString("hex");
}

// ---------- staff ----------
app.get("/api/staff", (req, res) => {
  const db = readDB();
  const token = req.headers["x-owner-token"];
  const owner = token && ownerTokens.has(token);
  const staff = owner ? db.staff : db.staff.map(({ id, name, active }) => ({ id, name, active }));
  res.json(staff);
});

app.post("/api/staff", requireOwner, (req, res) => {
  const { name, pin } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  if (!pin || !/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: "PIN must be exactly 4 digits." });
  const db = readDB();
  const member = { id: id("s"), name: name.trim(), active: true, pin: String(pin) };
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
  if (typeof req.body.pin !== "undefined") {
    if (!/^\d{4}$/.test(String(req.body.pin))) return res.status(400).json({ error: "PIN must be exactly 4 digits." });
    member.pin = String(req.body.pin);
  }
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
  const { serviceId, price, paymentMethod, customerName, note } = req.body;
  if (!serviceId) return res.status(400).json({ error: "Service is required." });
  if (typeof price !== "number" || price < 0) return res.status(400).json({ error: "Price must be a non-negative number." });
  const validMethods = ["cash", "card", "upi", "other"];
  if (!validMethods.includes(paymentMethod)) return res.status(400).json({ error: "Invalid payment method." });

  const db = readDB();
  const staff = db.staff.find((s) => s.id === req.staffId);
  const service = db.services.find((s) => s.id === serviceId);
  if (!staff) return res.status(404).json({ error: "Staff member not found." });
  if (!service) return res.status(404).json({ error: "Service not found." });

  const now = new Date();
  const entry = {
    id: id("e"),
    staffId: staff.id,
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
