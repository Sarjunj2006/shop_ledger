const API = "/api";
let staffCache = [];
let servicesCache = [];
let selectedPayment = "cash";
const OWNER_TOKEN_KEY = "shopLedgerOwnerToken";
const STAFF_TOKEN_KEY = "shopLedgerStaffToken";

function ownerToken() {
  return sessionStorage.getItem(OWNER_TOKEN_KEY);
}
function isOwner() {
  return !!ownerToken();
}
function staffToken() {
  return sessionStorage.getItem(STAFF_TOKEN_KEY);
}
function isStaff() {
  return !!staffToken();
}
function setOwnerMode(on) {
  document.body.classList.toggle("owner-mode", on);
}
function showLoginScreen() {
  document.getElementById("login-screen").hidden = false;
  document.getElementById("app-frame").hidden = true;
}
function showApp() {
  document.getElementById("login-screen").hidden = true;
  document.getElementById("app-frame").hidden = false;
}

function switchToTab(tabName) {
  const btn = document.querySelector(`.tab[data-tab="${tabName}"]`);
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("panel-" + tabName).classList.add("active");
  if (tabName === "today") loadToday();
  if (tabName === "reports") loadReports();
  if (tabName === "manage") loadManage();
  if (tabName === "settings") loadSettings();
  window.scrollTo({ top: 0, behavior: "instant" });
}

// ---------- tabs ----------
document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  // Owner-only tabs stay inert for staff even if somehow clicked (e.g. dev tools).
  if (btn.classList.contains("owner-only") && !isOwner()) {
    openAccessModal("owner");
    return;
  }
  switchToTab(btn.dataset.tab);
});

// ---------- shared login modal (staff password OR owner password) ----------
const accessModal = document.getElementById("access-modal");
let accessModalMode = "staff"; // "staff" | "owner"

function openAccessModal(mode) {
  accessModalMode = mode;
  const isOwnerMode = mode === "owner";
  document.getElementById("access-modal-title").textContent = isOwnerMode ? "Owner access" : "Staff access";
  document.getElementById("access-modal-desc").textContent = isOwnerMode
    ? "Enter the owner password to see reports, today's book, and staff/service settings."
    : "Enter the staff password to log services.";
  document.getElementById("access-login-error").textContent = "";
  document.getElementById("access-password").value = "";
  document.getElementById("forgot-password-link").hidden = isOwnerMode;
  showModalStep("access-login-form");
  accessModal.hidden = false;
  document.getElementById("access-password").focus();
}
function closeAccessModal() {
  accessModal.hidden = true;
}
function showModalStep(formId) {
  ["access-login-form", "forgot-email-form", "reset-password-form"].forEach((id) => {
    document.getElementById(id).hidden = id !== formId;
  });
}

document.getElementById("staff-login-open").addEventListener("click", () => openAccessModal("staff"));
document.getElementById("owner-login-open").addEventListener("click", () => openAccessModal("owner"));
document.getElementById("owner-login-btn").addEventListener("click", () => openAccessModal("owner"));
document.getElementById("access-cancel-btn").addEventListener("click", closeAccessModal);

document.getElementById("access-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("access-login-error");
  const password = document.getElementById("access-password").value;
  const endpoint = accessModalMode === "owner" ? "/owner/login" : "/staff-access/login";
  try {
    const res = await fetch(API + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Incorrect password.");
    }
    const { token } = await res.json();
    if (accessModalMode === "owner") {
      sessionStorage.setItem(OWNER_TOKEN_KEY, token);
      setOwnerMode(true);
      closeAccessModal();
      showApp();
      switchToTab("today");
    } else {
      sessionStorage.setItem(STAFF_TOKEN_KEY, token);
      closeAccessModal();
      showApp();
      switchToTab("entry");
    }
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ---------- forgot password (email a code, then reset) ----------
document.getElementById("forgot-password-link").addEventListener("click", () => {
  document.getElementById("forgot-email-error").textContent = "";
  document.getElementById("forgot-email-success").textContent = "";
  document.getElementById("forgot-email").value = "";
  showModalStep("forgot-email-form");
  document.getElementById("forgot-email").focus();
});
document.getElementById("forgot-back-btn").addEventListener("click", () => showModalStep("access-login-form"));
document.getElementById("reset-back-btn").addEventListener("click", () => showModalStep("access-login-form"));

document.getElementById("forgot-email-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("forgot-email-error");
  const successEl = document.getElementById("forgot-email-success");
  errEl.textContent = "";
  successEl.textContent = "";
  const email = document.getElementById("forgot-email").value;
  try {
    const res = await fetch(API + "/staff-access/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Something went wrong.");
    successEl.textContent = body.message;
    document.getElementById("reset-password-error").textContent = "";
    document.getElementById("reset-code").value = "";
    document.getElementById("reset-new-password").value = "";
    setTimeout(() => showModalStep("reset-password-form"), 700);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById("reset-password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("reset-password-error");
  errEl.textContent = "";
  const code = document.getElementById("reset-code").value;
  const newPassword = document.getElementById("reset-new-password").value;
  try {
    const res = await fetch(API + "/staff-access/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, newPassword }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Something went wrong.");
    // Password changed — send them back to the normal login step to sign in with it.
    showModalStep("access-login-form");
    document.getElementById("access-login-error").textContent = "Password updated — log in with your new password.";
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById("staff-logout-btn").addEventListener("click", async () => {
  try {
    await fetch(API + "/staff-access/logout", {
      method: "POST",
      headers: { "x-staff-token": staffToken() || "" },
    });
  } catch {}
  sessionStorage.removeItem(STAFF_TOKEN_KEY);
  if (!isOwner()) showLoginScreen();
});

document.getElementById("owner-logout-btn").addEventListener("click", async () => {
  try {
    await fetch(API + "/owner/logout", {
      method: "POST",
      headers: { "x-owner-token": ownerToken() || "" },
    });
  } catch {}
  sessionStorage.removeItem(OWNER_TOKEN_KEY);
  setOwnerMode(false);
  if (isStaff()) {
    switchToTab("entry");
  } else {
    showLoginScreen();
  }
});

// ---------- helpers ----------
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (ownerToken()) headers["x-owner-token"] = ownerToken();
  if (staffToken()) headers["x-staff-token"] = staffToken();
  const res = await fetch(API + path, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      // Token missing/expired (e.g. server restarted) — drop back to the login screen.
      sessionStorage.removeItem(OWNER_TOKEN_KEY);
      sessionStorage.removeItem(STAFF_TOKEN_KEY);
      setOwnerMode(false);
      showLoginScreen();
    }
    throw new Error(body.error || "Something went wrong.");
  }
  if (res.status === 204) return null;
  return res.json();
}
function money(n) {
  return "₹" + Number(n).toLocaleString("en-IN");
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ---------- entry form ----------
async function loadFormOptions() {
  [staffCache, servicesCache] = await Promise.all([api("/staff"), api("/services")]);
  const staffSel = document.getElementById("f-staff");
  const svcSel = document.getElementById("f-service");
  staffSel.innerHTML = staffCache
    .filter((s) => s.active)
    .map((s) => `<option value="${s.id}">${s.name}</option>`)
    .join("");
  svcSel.innerHTML = servicesCache
    .map((s) => `<option value="${s.id}" data-price="${s.price}">${s.name} — ${money(s.price)}</option>`)
    .join("");
  applyServicePrice();
}
function applyServicePrice() {
  const svcSel = document.getElementById("f-service");
  const opt = svcSel.options[svcSel.selectedIndex];
  if (opt) document.getElementById("f-price").value = opt.dataset.price;
}
document.getElementById("f-service").addEventListener("change", applyServicePrice);

document.getElementById("f-payment").addEventListener("click", (e) => {
  const pill = e.target.closest(".pill");
  if (!pill) return;
  document.querySelectorAll("#f-payment .pill").forEach((p) => p.classList.remove("active"));
  pill.classList.add("active");
  selectedPayment = pill.dataset.value;
});

document.getElementById("entry-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("entry-status");
  statusEl.textContent = "";
  statusEl.className = "status-msg";

  const staffId = document.getElementById("f-staff").value;
  const serviceId = document.getElementById("f-service").value;
  const price = Number(document.getElementById("f-price").value);
  const customerName = document.getElementById("f-customer").value;
  const note = document.getElementById("f-note").value;

  try {
    const entry = await api("/entries", {
      method: "POST",
      body: JSON.stringify({ staffId, serviceId, price, paymentMethod: selectedPayment, customerName, note }),
    });
    statusEl.textContent = `Logged: ${entry.serviceName} by ${entry.staffName} — ${money(entry.price)}`;
    prependRecent(entry);
    document.getElementById("f-customer").value = "";
    document.getElementById("f-note").value = "";
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add("error");
  }
});

function prependRecent(entry) {
  const list = document.getElementById("recent-list");
  // Only one confirmation shown at a time — clear anything still fading from a previous submit.
  list.innerHTML = "";
  const li = document.createElement("li");
  li.innerHTML = `<span>${entry.time} · ${entry.staffName} · ${entry.serviceName}</span><span class="amt">${money(entry.price)}</span>`;
  list.appendChild(li);

  // Let it sit for a few seconds, then fade out and remove.
  setTimeout(() => li.classList.add("fade-out"), 3500);
  setTimeout(() => li.remove(), 4100);
}

// ---------- today's book ----------
async function loadToday() {
  const entries = await api("/entries?date=" + todayStr());
  const tbody = document.querySelector("#today-table tbody");
  const emptyMsg = document.getElementById("today-empty");
  tbody.innerHTML = "";
  emptyMsg.hidden = entries.length > 0;

  let total = 0;
  for (const e of entries) {
    total += e.price;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e.time}</td>
      <td>${e.staffName}</td>
      <td>${e.serviceName}</td>
      <td>${e.customerName || "—"}</td>
      <td>${e.paymentMethod.toUpperCase()}</td>
      <td class="amount">${money(e.price)}</td>
      <td><button class="row-delete" data-id="${e.id}">Remove</button></td>`;
    tbody.appendChild(tr);
  }
  document.getElementById("today-totals").textContent =
    entries.length ? `${entries.length} services · ${money(total)} total` : "";

  tbody.querySelectorAll(".row-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api("/entries/" + btn.dataset.id, { method: "DELETE" });
      loadToday();
    });
  });
}

// ---------- reports ----------
document.getElementById("r-apply").addEventListener("click", loadReports);
document.getElementById("r-export").addEventListener("click", exportCSV);

async function loadReports() {
  const from = document.getElementById("r-from").value;
  const to = document.getElementById("r-to").value;
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);

  const summary = await api("/summary?" + qs.toString());
  document.getElementById("rep-total").textContent = money(summary.total);
  document.getElementById("rep-count").textContent = `${summary.count} service${summary.count === 1 ? "" : "s"}`;

  const staffList = document.getElementById("rep-staff");
  staffList.innerHTML = Object.entries(summary.byStaff)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, v]) => `<li><span>${name} (${v.count})</span><span class="amt">${money(v.total)}</span></li>`)
    .join("") || "<li>No entries in this range.</li>";

  const payList = document.getElementById("rep-payment");
  payList.innerHTML = Object.entries(summary.byPayment)
    .filter(([, total]) => total > 0)
    .map(([method, total]) => `<li><span>${method.toUpperCase()}</span><span class="amt">${money(total)}</span></li>`)
    .join("") || "<li>No entries in this range.</li>";

  const svcList = document.getElementById("rep-service");
  svcList.innerHTML = Object.entries(summary.byService)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, v]) => `<li><span>${name} (${v.count})</span><span class="amt">${money(v.total)}</span></li>`)
    .join("") || "<li>No entries in this range.</li>";
}

async function exportCSV() {
  const from = document.getElementById("r-from").value;
  const to = document.getElementById("r-to").value;
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const entries = await api("/entries?" + qs.toString());

  const rows = [["Date", "Time", "Staff", "Service", "Customer", "Payment", "Amount"]];
  for (const e of entries) {
    rows.push([e.date, e.time, e.staffName, e.serviceName, e.customerName, e.paymentMethod, e.price]);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `shop-ledger_${from || "all"}_${to || "all"}.csv`;
  a.click();
}

// ---------- manage staff & services ----------
document.getElementById("staff-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("staff-name");
  await api("/staff", { method: "POST", body: JSON.stringify({ name: input.value }) });
  input.value = "";
  loadManage();
  loadFormOptions();
});

document.getElementById("service-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("service-name");
  const priceInput = document.getElementById("service-price");
  await api("/services", {
    method: "POST",
    body: JSON.stringify({ name: nameInput.value, price: Number(priceInput.value) }),
  });
  nameInput.value = "";
  priceInput.value = "";
  loadManage();
  loadFormOptions();
});

async function loadManage() {
  const [staff, services] = await Promise.all([api("/staff"), api("/services")]);
  const staffList = document.getElementById("staff-list");
  staffList.innerHTML = staff
    .map((s) => `<li>${s.name}<button data-id="${s.id}" data-type="staff">Remove</button></li>`)
    .join("");

  const serviceList = document.getElementById("service-list");
  serviceList.innerHTML = services
    .map(
      (s) =>
        `<li>${s.name} <span class="meta">${money(s.price)}</span><button data-id="${s.id}" data-type="service">Remove</button></li>`
    )
    .join("");

  document.querySelectorAll("#staff-list button, #service-list button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const path = btn.dataset.type === "staff" ? "/staff/" : "/services/";
      await api(path + btn.dataset.id, { method: "DELETE" });
      loadManage();
      loadFormOptions();
    });
  });
}

// ---------- settings (recovery email) ----------
document.getElementById("settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("settings-error");
  const successEl = document.getElementById("settings-success");
  errEl.textContent = "";
  successEl.textContent = "";
  const input = document.getElementById("settings-email");
  try {
    await api("/settings", { method: "PATCH", body: JSON.stringify({ ownerEmail: input.value }) });
    successEl.textContent = "Saved.";
  } catch (err) {
    errEl.textContent = err.message;
  }
});

async function loadSettings() {
  const settings = await api("/settings");
  document.getElementById("settings-email").value = settings.ownerEmail || "";
}

// ---------- init ----------
loadFormOptions();
setOwnerMode(isOwner());
if (isOwner() || isStaff()) {
  showApp();
  switchToTab(isOwner() ? "today" : "entry");
} else {
  showLoginScreen();
}
document.getElementById("r-from").value = todayStr();
document.getElementById("r-to").value = todayStr();
