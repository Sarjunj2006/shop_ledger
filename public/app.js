const API = "/api";
let staffCache = [];
let servicesCache = [];
let selectedPayment = "cash";
const OWNER_TOKEN_KEY = "shopLedgerOwnerToken";
const STAFF_TOKEN_KEY = "shopLedgerStaffToken";
const STAFF_NAME_KEY = "shopLedgerStaffName";

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
function staffName() {
  return sessionStorage.getItem(STAFF_NAME_KEY) || "";
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
  document.getElementById("staff-session-badge").textContent = isStaff() ? `Logged in as ${staffName()}` : "";
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
  window.scrollTo({ top: 0, behavior: "instant" });
}

// ---------- tabs ----------
document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  // Owner-only tabs stay inert for staff even if somehow clicked (e.g. dev tools).
  if (btn.classList.contains("owner-only") && !isOwner()) {
    openOwnerModal();
    return;
  }
  switchToTab(btn.dataset.tab);
});

// ---------- staff login (PIN) ----------
document.getElementById("staff-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("staff-login-error");
  errEl.textContent = "";
  const staffId = document.getElementById("login-staff").value;
  const pin = document.getElementById("login-pin").value;
  try {
    const res = await fetch(API + "/staff/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffId, pin }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Login failed.");
    }
    const data = await res.json();
    sessionStorage.setItem(STAFF_TOKEN_KEY, data.token);
    sessionStorage.setItem(STAFF_NAME_KEY, data.staffName);
    document.getElementById("login-pin").value = "";
    showApp();
    switchToTab("entry");
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById("staff-logout-btn").addEventListener("click", async () => {
  try {
    await fetch(API + "/staff/logout", {
      method: "POST",
      headers: { "x-staff-token": staffToken() || "" },
    });
  } catch {}
  sessionStorage.removeItem(STAFF_TOKEN_KEY);
  sessionStorage.removeItem(STAFF_NAME_KEY);
  if (isOwner()) {
    document.getElementById("staff-session-badge").textContent = "";
  } else {
    showLoginScreen();
  }
});

// ---------- owner login / logout ----------
const ownerModal = document.getElementById("owner-modal");
function openOwnerModal() {
  document.getElementById("owner-login-error").textContent = "";
  document.getElementById("owner-password").value = "";
  ownerModal.hidden = false;
  document.getElementById("owner-password").focus();
}
function closeOwnerModal() {
  ownerModal.hidden = true;
}
document.getElementById("owner-login-btn").addEventListener("click", openOwnerModal);
document.getElementById("owner-login-link").addEventListener("click", openOwnerModal);
document.getElementById("owner-cancel-btn").addEventListener("click", closeOwnerModal);

document.getElementById("owner-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("owner-login-error");
  const password = document.getElementById("owner-password").value;
  try {
    const res = await fetch(API + "/owner/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Incorrect password.");
    }
    const { token } = await res.json();
    sessionStorage.setItem(OWNER_TOKEN_KEY, token);
    setOwnerMode(true);
    closeOwnerModal();
    showApp();
    switchToTab("today");
  } catch (err) {
    errEl.textContent = err.message;
  }
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
      sessionStorage.removeItem(STAFF_NAME_KEY);
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
  const loginStaffSel = document.getElementById("login-staff");
  const svcSel = document.getElementById("f-service");
  loginStaffSel.innerHTML = staffCache
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

  const serviceId = document.getElementById("f-service").value;
  const price = Number(document.getElementById("f-price").value);
  const customerName = document.getElementById("f-customer").value;
  const note = document.getElementById("f-note").value;

  try {
    const entry = await api("/entries", {
      method: "POST",
      body: JSON.stringify({ serviceId, price, paymentMethod: selectedPayment, customerName, note }),
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
  const errEl = document.getElementById("staff-manage-error");
  const nameInput = document.getElementById("staff-name");
  const pinInput = document.getElementById("staff-pin");
  try {
    await api("/staff", { method: "POST", body: JSON.stringify({ name: nameInput.value, pin: pinInput.value }) });
    nameInput.value = "";
    pinInput.value = "";
    if (errEl) errEl.textContent = "";
    loadManage();
    loadFormOptions();
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  }
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
    .map(
      (s) =>
        `<li>${s.name} <span class="meta">PIN ${s.pin || "----"}</span>
          <span>
            <button data-id="${s.id}" data-type="staff-pin">Change PIN</button>
            <button data-id="${s.id}" data-type="staff">Remove</button>
          </span>
        </li>`
    )
    .join("");

  const serviceList = document.getElementById("service-list");
  serviceList.innerHTML = services
    .map(
      (s) =>
        `<li>${s.name} <span class="meta">${money(s.price)}</span><button data-id="${s.id}" data-type="service">Remove</button></li>`
    )
    .join("");

  document.querySelectorAll('#staff-list button[data-type="staff-pin"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const newPin = prompt("New 4-digit PIN:");
      if (newPin === null) return;
      if (!/^\d{4}$/.test(newPin)) {
        alert("PIN must be exactly 4 digits.");
        return;
      }
      try {
        await api("/staff/" + btn.dataset.id, { method: "PATCH", body: JSON.stringify({ pin: newPin }) });
        loadManage();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  document.querySelectorAll('#staff-list button[data-type="staff"], #service-list button[data-type="service"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const path = btn.dataset.type === "staff" ? "/staff/" : "/services/";
      await api(path + btn.dataset.id, { method: "DELETE" });
      loadManage();
      loadFormOptions();
    });
  });
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
