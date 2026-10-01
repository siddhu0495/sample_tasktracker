/* Daily Task Tracker - front end (vanilla JS, no external libraries). */
"use strict";

const STATUSES = [
  { id: "todo", name: "To Do", color: "var(--todo)" },
  { id: "in_progress", name: "In Progress", color: "var(--progress)" },
  { id: "in_review", name: "In Review", color: "var(--review)" },
  { id: "done", name: "Complete", color: "var(--done)" },
];
const PRIORITIES = [
  { id: "urgent", name: "Urgent" }, { id: "high", name: "High" },
  { id: "normal", name: "Normal" }, { id: "low", name: "Low" },
];
const PERIODS = [
  { id: "all", name: "Everything", icon: "◎" },
  { id: "today", name: "Today", icon: "☀" },
  { id: "week", name: "This Week", icon: "▤" },
  { id: "month", name: "This Month", icon: "▦" },
  { id: "year", name: "This Year", icon: "◷" },
  { id: "overdue", name: "Overdue", icon: "⚠" },
  { id: "nodate", name: "No date", icon: "○" },
];
const REC_NAMES = { none: "Does not repeat", daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
const PALETTE = ["#7b68ee", "#0f8cff", "#2bb673", "#ff7a00", "#e5484d", "#9b5de5", "#00a3a3", "#d6336c", "#5c7cfa", "#f59f00"];

const S = {
  data: { workspace: "My Workspace", lists: [], tasks: [] },
  view: "home", list: null, period: "all", search: "", prio: "", showDone: false,
  collapsed: {}, cal: null, selected: null, dataDir: "", platform: "",
};
try { Object.assign(S, JSON.parse(localStorage.getItem("tt-ui") || "{}"), { selected: null }); } catch (e) { /* ignore */ }
const saveUi = () => { try { localStorage.setItem("tt-ui", JSON.stringify({ view: S.view, list: S.list, period: S.period, prio: S.prio, showDone: S.showDone, collapsed: S.collapsed })); } catch (e) { /* ignore */ } };

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = (s) => { if (!s) return null; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const colorFor = (s) => PALETTE[hash(s) % PALETTE.length];
const initials = (n) => n.split(/[\s.@_-]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join("");
const fmtDate = (s) => { const d = parseD(s); if (!d) return ""; const t = today(); const diff = Math.round((d - t) / 864e5);
  if (diff === 0) return "Today"; if (diff === 1) return "Tomorrow"; if (diff === -1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== t.getFullYear() ? { year: "numeric" } : {}) }); };

function periodRange(p) {
  const t = today();
  if (p === "today") return [t, t];
  if (p === "week") { const s = addDays(t, -((t.getDay() + 6) % 7)); return [s, addDays(s, 6)]; }
  if (p === "month") return [new Date(t.getFullYear(), t.getMonth(), 1), new Date(t.getFullYear(), t.getMonth() + 1, 0)];
  if (p === "year") return [new Date(t.getFullYear(), 0, 1), new Date(t.getFullYear(), 11, 31)];
  return null;
}

/* does the task (incl. recurrences) fall on a day in [from, to]? */
function occursIn(t, from, to) {
  const base = parseD(t.due_date || t.start_date);
  if (!base) return false;
  if (t.recurrence === "none" || !t.recurrence || t.status === "done") return base >= from && base <= to;
  const start = base > from ? base : from;
  if (start > to) return false;
  for (let d = new Date(start); d <= to; d = addDays(d, 1)) {
    if (matchesRec(t.recurrence, base, d)) return true;
  }
  return false;
}
function matchesRec(rec, base, d) {
  if (rec === "daily") return true;
  if (rec === "weekly") return d.getDay() === base.getDay();
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const dayOk = d.getDate() === Math.min(base.getDate(), lastDay);
  if (rec === "monthly") return dayOk;
  if (rec === "yearly") return dayOk && d.getMonth() === base.getMonth();
  return false;
}
const isOverdue = (t) => t.status !== "done" && t.due_date && parseD(t.due_date) < today();

function inPeriod(t, p) {
  if (p === "all") return true;
  if (p === "overdue") return isOverdue(t);
  if (p === "nodate") return !t.due_date && !t.start_date;
  const [a, b] = periodRange(p);
  if (p !== "today" && isOverdue(t)) return false;
  return occursIn(t, a, b) || (p === "today" && isOverdue(t));
}

function baseTasks() {
  const q = S.search.trim().toLowerCase();
  return S.data.tasks.filter((t) =>
    (!S.list || t.list === S.list) &&
    (!S.prio || t.priority === S.prio) &&
    (!q || [t.title, t.description, t.notes, t.assignee, t.labels.join(" "), t.list].join(" ").toLowerCase().includes(q)));
}
const visible = (tasks, p = S.period) => tasks.filter((t) => inPeriod(t, p) && (S.showDone || t.status !== "done" || p === "done"));

const PRIO_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
const sortTasks = (arr) => arr.sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999") || PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority] || a.title.localeCompare(b.title));

/* ---------- API ---------- */
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
async function load() {
  const st = await api("GET", "/api/state");
  S.data = { workspace: st.workspace, lists: st.lists, tasks: st.tasks };
  S.dataDir = st.data_dir; S.platform = st.platform;
  if (S.list && !S.data.lists.includes(S.list)) S.list = null;
  render();
}
function toast(msg, error) {
  const el = document.createElement("div");
  el.className = "toast" + (error ? " error" : ""); el.textContent = msg;
  $("#toasts").appendChild(el); setTimeout(() => el.remove(), error ? 6000 : 2800);
}
async function createTask(fields) {
  const t = await api("POST", "/api/tasks", { list: S.list || S.data.lists[0], ...fields });
  S.data.tasks.push(t);
  if (!S.data.lists.includes(t.list)) S.data.lists.push(t.list);
  render(); return t;
}
async function updateTask(id, fields) {
  const t = await api("PUT", `/api/tasks/${id}`, fields);
  const i = S.data.tasks.findIndex((x) => x.id === id);
  if (i >= 0) S.data.tasks[i] = t;
  if (!S.data.lists.includes(t.list)) S.data.lists.push(t.list);
  return t;
}
async function deleteTask(id) {
  const t = S.data.tasks.find((x) => x.id === id);
  if (!t || !confirm(`Delete "${t.title}"?`)) return;
  await api("DELETE", `/api/tasks/${id}`);
  S.data.tasks = S.data.tasks.filter((x) => x.id !== id);
  if (S.selected === id) closeDrawer();
  render(); toast("Task deleted");
}
async function cycleStatus(id) {
  const t = S.data.tasks.find((x) => x.id === id);
  const next = t.status === "done" ? "todo" : "done";
  const u = await updateTask(id, { status: next });
  if (t.recurrence !== "none" && next === "done") toast(`Recurring task done - next due ${fmtDate(u.due_date)}`);
  render(); if (S.selected === id) openDrawer(id);
}

/* ---------- rendering ---------- */
function render() {
  saveUi();
  $("#workspaceName").textContent = S.data.workspace;
  document.title = `${S.data.workspace} · Daily Task Tracker`;
  $("#dataPath").textContent = S.dataDir ? `Saved to: ${S.dataDir}` : "";
  renderSidebar();
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === S.view));
  document.querySelectorAll(".rail-btn").forEach((b) => b.classList.toggle("active",
    b.dataset.nav === (S.view === "board" ? "list" : S.view)));
  const per = PERIODS.find((p) => p.id === S.period);
  $("#viewTitle").textContent = (S.list || "Everything") + (S.view !== "home" && S.view !== "calendar" && S.period !== "all" ? ` · ${per.name}` : "");
  $("#crumbIco").textContent = S.list ? S.list[0].toUpperCase() : "◎";
  $("#crumbIco").style.background = S.list ? colorFor(S.list) : "#e5484d";
  $("#prioFilter").value = S.prio; $("#showDone").checked = S.showDone;
  renderChips();
  const c = $("#content");
  if (S.view === "home") c.innerHTML = renderPlanner();
  else if (S.view === "board") c.innerHTML = renderBoard();
  else if (S.view === "calendar") c.innerHTML = renderCalendar();
  else c.innerHTML = renderList();
  bindContent();
}

function renderSidebar() {
  const base = baseTasks().filter((t) => t.status !== "done");
  $("#periodNav").innerHTML = PERIODS.map((p) => {
    const n = base.filter((t) => inPeriod(t, p.id)).length;
    return `<div class="nav-item ${S.period === p.id && S.view !== "calendar" ? "active" : ""} ${p.id === "overdue" && n ? "danger" : ""}" data-period="${p.id}">
      <span class="pi">${p.icon}</span>${p.name}<span class="count">${n || ""}</span></div>`;
  }).join("");
  const open = S.data.tasks.filter((t) => t.status !== "done");
  $("#listNav").innerHTML = `<div class="nav-item ${!S.list ? "active" : ""}" data-list=""><span class="sw" style="background:#e5484d">◎</span>All lists<span class="count">${open.length || ""}</span></div>` +
    S.data.lists.map((l) => `<div class="nav-item ${S.list === l ? "active" : ""}" data-list="${esc(l)}">
      <span class="sw" style="background:${colorFor(l)}">${esc(l[0].toUpperCase())}</span><span class="t">${esc(l)}</span>
      <span class="count">${open.filter((t) => t.list === l).length || ""}</span><button class="icon-btn more" data-listmenu="${esc(l)}" title="List options">⋯</button></div>`).join("");
}

function renderChips() {
  const show = S.view === "list" || S.view === "board";
  $("#periodChips").style.visibility = show ? "visible" : "hidden";
  if (!show) return;
  const base = baseTasks().filter((t) => t.status !== "done");
  $("#periodChips").innerHTML = PERIODS.map((p) =>
    `<button class="chip ${S.period === p.id ? "active" : ""}" data-period="${p.id}">${p.name}<span class="n">${base.filter((t) => inPeriod(t, p.id)).length}</span></button>`).join("");
}

const prioHtml = (p) => `<span class="flag p-${p}"><i>⚑</i>${PRIORITIES.find((x) => x.id === p).name}</span>`;
const avatarHtml = (a) => a ? `<span class="avatar" style="background:${colorFor(a)}" title="${esc(a)}">${esc(initials(a))}</span>` : `<span class="avatar empty">+</span>`;
const labelsHtml = (ls) => ls.map((l) => { const c = colorFor(l); return `<span class="label" style="color:${c};background:${c}1a">${esc(l)}</span>`; }).join("");
function dueHtml(t) {
  if (!t.due_date) return `<span class="due" style="color:var(--faint)">—</span>`;
  const cls = isOverdue(t) ? "overdue" : t.due_date === iso(today()) && t.status !== "done" ? "today" : "";
  return `<span class="due ${cls}">${fmtDate(t.due_date)}</span>`;
}
const recHtml = (t) => t.recurrence && t.recurrence !== "none" ? `<span class="rec" title="Repeats ${t.recurrence}">⟳ ${t.recurrence}</span>` : "";

function rowHtml(t) {
  return `<div class="row ${t.status === "done" ? "is-done" : ""} ${S.selected === t.id ? "selected" : ""}" data-id="${t.id}">
    <div class="cell name"><button class="sbtn ${t.status}" data-status="${t.id}" title="Mark complete"></button><span class="t">${esc(t.title)}</span>${recHtml(t)}${t.description || t.notes ? '<span class="tag-mini" title="Has description / notes">≡</span>' : ""}</div>
    <div class="cell">${prioHtml(t.priority)}</div>
    <div class="cell c-assignee">${avatarHtml(t.assignee)}</div>
    <div class="cell c-labels">${labelsHtml(t.labels)}</div>
    <div class="cell">${dueHtml(t)}</div>
    <div class="cell c-list"><span class="label" style="color:${colorFor(t.list)};background:${colorFor(t.list)}14">${esc(t.list)}</span></div>
    <div class="cell"><button class="icon-btn del" data-del="${t.id}" title="Delete">🗑</button></div></div>`;
}

function renderList() {
  const tasks = sortTasks(visible(baseTasks()));
  if (!S.data.tasks.length) return emptyState();
  return STATUSES.filter((s) => s.id !== "done" || S.showDone).map((s) => {
    const items = tasks.filter((t) => t.status === s.id);
    const col = S.collapsed[s.id];
    return `<div class="group ${col ? "collapsed" : ""}">
      <div class="group-head"><button class="collapse" data-collapse="${s.id}">▾</button>
        <span class="pill" style="background:${s.color}">◔ ${s.name}</span><span class="group-count">${items.length}</span></div>
      ${col ? "" : `<div class="thead"><div>Name</div><div>Priority</div><div class="c-assignee">Assignee</div><div class="c-labels">Labels</div><div>Due date</div><div class="c-list">List</div><div></div></div>
      ${items.map(rowHtml).join("")}
      <div class="add-row"><span class="plus">+</span><input placeholder="Add task" data-add="${s.id}"><span class="cnt">Count <b>${items.length}</b></span></div>`}
    </div>`;
  }).join("");
}

function cardHtml(t, draggable) {
  return `<div class="card ${t.status === "done" ? "is-done" : ""}" data-id="${t.id}" ${draggable ? 'draggable="true"' : ""}>
    <div class="ct"><button class="sbtn ${t.status}" data-status="${t.id}"></button><span class="t">${esc(t.title)}</span>${t.assignee ? avatarHtml(t.assignee) : ""}</div>
    <div class="cm">${prioHtml(t.priority)}${dueHtml(t)}${recHtml(t)}${labelsHtml(t.labels.slice(0, 2))}${!S.list ? `<span>· ${esc(t.list)}</span>` : ""}</div></div>`;
}

function renderPlanner() {
  if (!S.data.tasks.length) return emptyState();
  const base = baseTasks();
  const seen = new Set();
  const COLS = [["overdue", "Overdue"], ["today", "Today"], ["week", "Later this week"], ["month", "Later this month"], ["year", "Later this year"]];
  const cols = COLS.map(([id, title]) => {
    const p = PERIODS.find((x) => x.id === id);
    const all = base.filter((t) => inPeriod(t, id));
    const done = all.filter((t) => t.status === "done").length;
    // each task appears once, in the earliest column it belongs to
    const items = sortTasks(all.filter((t) => !seen.has(t.id) && (S.showDone || t.status !== "done")));
    items.forEach((t) => seen.add(t.id));
    const pct = all.length ? Math.round((done / all.length) * 100) : 0;
    const [a, b] = periodRange(id) || [];
    const md = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const sub = id === "overdue" ? "Past due, not complete" : id === "today" ? today().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : `${md(a)} – ${md(b)}`;
    const stat = id === "overdue" ? "" : ` · ${p.name}: ${done}/${all.length} done`;
    return `<div class="pcol"><div class="pcol-head"><h3>${p.icon} ${title} <span class="group-count">${items.length}</span></h3>
      <div class="sub">${sub}${stat}</div>${id !== "overdue" ? `<div class="bar" title="${pct}% of ${p.name.toLowerCase()} done"><div style="width:${pct}%"></div></div>` : ""}</div>
      <div class="pcol-body">${items.map((t) => cardHtml(t)).join("") || `<div class="hint" style="padding:6px 4px">${id === "overdue" ? "Nothing overdue 🎉" : "No tasks"}</div>`}
      ${id !== "overdue" ? `<button class="mini-add" data-quick="${id}">＋ Add task</button>` : ""}</div></div>`;
  });
  return `<div class="planner">${cols.join("")}</div>`;
}

function renderBoard() {
  const tasks = sortTasks(visible(baseTasks()));
  return `<div class="board">${STATUSES.map((s) => {
    const items = tasks.filter((t) => t.status === s.id);
    return `<div class="bcol" data-drop="${s.id}"><div class="bcol-head"><span class="pill" style="background:${s.color}">${s.name}</span><span class="group-count">${items.length}</span></div>
      <div class="bcol-body">${items.map((t) => cardHtml(t, true)).join("")}</div>
      <button class="mini-add btn ghost" data-quickstatus="${s.id}" style="margin-top:6px">＋ Add task</button></div>`;
  }).join("")}</div>`;
}

function renderCalendar() {
  const t = today();
  if (!S.cal) S.cal = { y: t.getFullYear(), m: t.getMonth() };
  const first = new Date(S.cal.y, S.cal.m, 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const tasks = baseTasks().filter((x) => S.showDone || x.status !== "done");
  let cells = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const evs = tasks.filter((x) => occursIn(x, d, d));
    cells += `<div class="day ${d.getMonth() !== S.cal.m ? "other" : ""} ${+d === +t ? "today" : ""}" data-day="${iso(d)}"><div class="dn">${d.getDate()}</div>
      ${evs.slice(0, 4).map((x) => `<div class="ev ${x.status === "done" ? "is-done" : ""}" data-id="${x.id}" style="border-color:${STATUSES.find((s) => s.id === x.status).color}" title="${esc(x.title)}">${x.recurrence !== "none" ? "⟳ " : ""}${esc(x.title)}</div>`).join("")}
      ${evs.length > 4 ? `<div class="ev-more">+${evs.length - 4} more</div>` : ""}</div>`;
  }
  return `<div class="cal-head"><button class="btn" data-cal="-1">‹</button><h2>${first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
    <button class="btn" data-cal="1">›</button><button class="btn ghost" data-cal="0">Today</button><span class="hint">Click a day to add a task on that date.</span></div><div class="cal">${cells}</div>`;
}

function emptyState() {
  return `<div class="empty-state"><div class="big">🗂️</div><h3>No tasks yet</h3>
    <p>Add your first task, or import from Excel, CSV, text files, Outlook, OneNote or SharePoint.</p>
    <button class="btn primary" id="emptyNew">＋ New task</button> <button class="btn" id="emptyImport">⇪ Import</button></div>`;
}

/* ---------- events on rendered content ---------- */
function bindContent() {
  const c = $("#content");
  c.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", (e) => {
    if (e.target.closest("[data-status],[data-del]")) return;
    e.stopPropagation(); openDrawer(el.dataset.id);
  }));
  c.querySelectorAll("[data-status]").forEach((el) => el.addEventListener("click", (e) => { e.stopPropagation(); cycleStatus(el.dataset.status).catch((x) => toast(x.message, true)); }));
  c.querySelectorAll("[data-del]").forEach((el) => el.addEventListener("click", (e) => { e.stopPropagation(); deleteTask(el.dataset.del).catch((x) => toast(x.message, true)); }));
  c.querySelectorAll("[data-collapse]").forEach((el) => el.addEventListener("click", () => { S.collapsed[el.dataset.collapse] = !S.collapsed[el.dataset.collapse]; render(); }));
  c.querySelectorAll("[data-add]").forEach((el) => el.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || !el.value.trim()) return;
    const range = periodRange(S.period);
    await createTask({ title: el.value.trim(), status: el.dataset.add, due_date: range ? iso(range[0] < today() ? today() : range[0]) : "" });
    const again = $(`[data-add="${el.dataset.add}"]`); if (again) again.focus();
  }));
  c.querySelectorAll("[data-quick]").forEach((el) => el.addEventListener("click", () => {
    // "Later this week/month/year" columns: default to the end of that period
    const [, b] = periodRange(el.dataset.quick); newTask({ due_date: iso(el.dataset.quick === "today" ? today() : b) });
  }));
  c.querySelectorAll("[data-quickstatus]").forEach((el) => el.addEventListener("click", () => newTask({ status: el.dataset.quickstatus })));
  c.querySelectorAll("[data-day]").forEach((el) => el.addEventListener("click", () => newTask({ due_date: el.dataset.day })));
  c.querySelectorAll("[data-cal]").forEach((el) => el.addEventListener("click", () => {
    const n = +el.dataset.cal; const t = today();
    if (!n) S.cal = { y: t.getFullYear(), m: t.getMonth() };
    else { const d = new Date(S.cal.y, S.cal.m + n, 1); S.cal = { y: d.getFullYear(), m: d.getMonth() }; }
    render();
  }));
  const en = $("#emptyNew"); if (en) en.onclick = () => newTask({});
  const ei = $("#emptyImport"); if (ei) ei.onclick = () => openImport();
  // board drag & drop
  c.querySelectorAll(".card[draggable]").forEach((el) => {
    el.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", el.dataset.id); el.classList.add("dragging"); });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
  });
  c.querySelectorAll("[data-drop]").forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("over"); });
    col.addEventListener("dragleave", () => col.classList.remove("over"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault(); col.classList.remove("over");
      const id = e.dataTransfer.getData("text/plain");
      try { await updateTask(id, { status: col.dataset.drop }); render(); } catch (x) { toast(x.message, true); }
    });
  });
}

/* ---------- task drawer ---------- */
async function newTask(fields) {
  try {
    const t = await createTask({ title: "New task", ...fields });
    openDrawer(t.id, true);
  } catch (e) { toast(e.message, true); }
}
function closeDrawer() { S.selected = null; $("#drawer").classList.remove("open"); render(); }

function openDrawer(id, focusTitle) {
  const t = S.data.tasks.find((x) => x.id === id);
  if (!t) return;
  S.selected = id;
  document.querySelectorAll(".row").forEach((r) => r.classList.toggle("selected", r.dataset.id === id));
  const opt = (arr, v) => arr.map((o) => `<option value="${o.id}" ${o.id === v ? "selected" : ""}>${o.name}</option>`).join("");
  const lists = S.data.lists.map((l) => `<option ${l === t.list ? "selected" : ""}>${esc(l)}</option>`).join("");
  const d = $("#drawer");
  d.innerHTML = `<div class="dr-head"><span class="sw label" style="color:${colorFor(t.list)};background:${colorFor(t.list)}1a">${esc(t.list)}</span>
      <span>· ${esc(t.source === "manual" ? "Created manually" : "Imported from " + t.source)}</span><span class="saved" id="savedFlag">✓ Saved</span>
      <button class="icon-btn" id="drDel" title="Delete">🗑</button><button class="icon-btn" id="drClose" title="Close (Esc)">✕</button></div>
    <div class="dr-body">
      <textarea class="dr-title" id="fTitle" rows="1">${esc(t.title)}</textarea>
      <div class="grid2">
        <label>Status</label><select class="field" id="fStatus">${opt(STATUSES, t.status)}</select>
        <label>Priority</label><select class="field" id="fPriority">${opt(PRIORITIES, t.priority)}</select>
        <label>List</label><select class="field" id="fList">${lists}</select>
        <label>Assignee</label><input class="field" id="fAssignee" value="${esc(t.assignee)}" placeholder="Name or email" list="assigneeList">
        <label>Labels</label><input class="field" id="fLabels" value="${esc(t.labels.join(", "))}" placeholder="e.g. Client, Follow-up">
        <label>Start date</label><input class="field" type="date" id="fStart" value="${t.start_date}">
        <label>Due date</label><input class="field" type="date" id="fDue" value="${t.due_date}">
        <label>Repeat</label><select class="field" id="fRec">${Object.entries(REC_NAMES).map(([k, v]) => `<option value="${k}" ${k === t.recurrence ? "selected" : ""}>${v}</option>`).join("")}</select>
      </div>
      <div class="sec-title">Description</div>
      <textarea class="area" id="fDesc" placeholder="What needs to be done?">${esc(t.description)}</textarea>
      <div class="sec-title">Notes</div>
      <textarea class="area" id="fNotes" placeholder="Meeting notes, call outcomes, links…">${esc(t.notes)}</textarea>
      <datalist id="assigneeList">${[...new Set(S.data.tasks.map((x) => x.assignee).filter(Boolean))].map((a) => `<option value="${esc(a)}">`).join("")}</datalist>
      <div class="meta">Created ${esc(t.created_at.replace("T", " "))} · Updated ${esc(t.updated_at.replace("T", " "))}${t.completed_at ? ` · Last completed ${esc(t.completed_at.replace("T", " "))}` : ""}</div>
    </div>`;
  d.classList.add("open"); d.setAttribute("aria-hidden", "false");
  $("#drClose").onclick = closeDrawer;
  $("#drDel").onclick = () => deleteTask(id);
  const title = $("#fTitle");
  const fit = () => { title.style.height = "auto"; title.style.height = title.scrollHeight + "px"; };
  fit(); title.addEventListener("input", fit);
  title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } });
  if (focusTitle) { title.focus(); title.select(); }

  let timer;
  const collect = () => ({
    title: $("#fTitle").value, status: $("#fStatus").value, priority: $("#fPriority").value, list: $("#fList").value,
    assignee: $("#fAssignee").value.trim(), labels: $("#fLabels").value, start_date: $("#fStart").value,
    due_date: $("#fDue").value, recurrence: $("#fRec").value, description: $("#fDesc").value, notes: $("#fNotes").value,
  });
  const save = async (immediate) => {
    clearTimeout(timer);
    const run = async () => {
      try {
        const before = S.data.tasks.find((x) => x.id === id);
        const wasDone = before && before.status;
        const u = await updateTask(id, collect());
        const f = $("#savedFlag"); if (f) { f.classList.add("show"); setTimeout(() => f.classList.remove("show"), 1200); }
        if (wasDone !== "done" && collect().status === "done" && u.status !== "done") { toast(`Recurring task done - next due ${fmtDate(u.due_date)}`); openDrawer(id); }
        render(); document.querySelectorAll(".row").forEach((r) => r.classList.toggle("selected", r.dataset.id === id));
      } catch (e) { toast(e.message, true); }
    };
    if (immediate) run(); else timer = setTimeout(run, 600);
  };
  d.querySelectorAll("select, input[type=date]").forEach((el) => el.addEventListener("change", () => save(true)));
  d.querySelectorAll("textarea, input:not([type=date])").forEach((el) => {
    el.addEventListener("input", () => save(false));
    el.addEventListener("blur", () => save(true));
  });
}

/* ---------- import ---------- */
const IMP = { src: "file", tasks: [], warnings: [], busy: false, error: "" };
const SOURCES = [
  { id: "file", name: "Files", desc: "CSV, Excel, Text, JSON" },
  { id: "sharepoint", name: "SharePoint / Folder", desc: "Synced library or any folder" },
  { id: "outlook", name: "Outlook", desc: "Tasks, flagged mail, meetings" },
  { id: "onenote", name: "OneNote", desc: "To Do tagged items" },
];
function openImport(src) {
  if (src) IMP.src = src;
  IMP.tasks = []; IMP.warnings = []; IMP.error = "";
  $("#modalBack").classList.add("open"); renderImport();
}
function closeModal() { $("#modalBack").classList.remove("open"); }

function renderImport() {
  const lists = `<option value="">Keep from source (or ${esc(S.list || S.data.lists[0])})</option>` + S.data.lists.map((l) => `<option ${l === S.list ? "selected" : ""}>${esc(l)}</option>`).join("");
  const win = S.platform.startsWith("win");
  let form = "";
  if (IMP.src === "file") form = `
    <div class="drop" id="drop"><div style="font-size:30px">⇪</div><b>Drop files here or click to browse</b>
      <div class="hint">.xlsx · .csv · .tsv · .txt · .md · .json — several at once is fine</div></div>
    <input type="file" id="fileInput" multiple accept=".xlsx,.xlsm,.csv,.tsv,.txt,.md,.json" hidden>
    <div class="hint"><b>Excel / CSV:</b> columns like <i>Task, Priority, Status, Due Date, Start Date, Owner, Labels, Notes, Description, Repeat, Account</i> are matched automatically; other columns go into Notes.<br>
    <b>Text:</b> one task per line. Optional hints: <code>!high</code>, <code>due 2026-10-15</code>, <code>weekly</code>, <code>[x]</code> for done.</div>`;
  else if (IMP.src === "sharepoint") form = `
    <div class="form-row"><input class="input wide" id="folderPath" placeholder="C:\\Users\\you\\Company\\Sales Team - Documents\\Trackers">
      ${win ? '<button class="btn" id="browseBtn">Browse…</button>' : ""}<label><input type="checkbox" id="recursive" checked> Include sub-folders</label></div>
    <div class="hint">In SharePoint click <b>Sync</b> (or "Add shortcut to My files") so the library appears in File Explorer, then pick that folder. All CSV / Excel / text files inside are read.</div>
    <div class="sugg" id="sugg"></div>`;
  else if (IMP.src === "outlook") form = `
    <div class="form-row"><label><input type="checkbox" id="oTasks" checked> Outlook tasks (open)</label>
      <label><input type="checkbox" id="oFlag" checked> Flagged emails</label>
      <label><input type="checkbox" id="oCal" checked> Meetings in the next</label>
      <input class="input" type="number" id="oDays" value="14" min="1" max="365" style="width:80px"><label>days</label></div>
    <div class="hint">Reads the <b>classic Outlook desktop app</b> on this PC (no sign-in needed). Outlook may ask you to allow access - click Allow.</div>
    ${win ? "" : '<div class="warn">Available when running on Windows.</div>'}`;
  else form = `
    <div class="form-row"><label>Pages edited in the last</label><input class="input" type="number" id="nDays" value="30" min="1" max="3650" style="width:90px"><label>days</label>
      <label><input type="checkbox" id="nDone"> Include completed items</label></div>
    <div class="hint">Reads the <b>OneNote desktop app</b> and imports every tagged item (To Do ☐, Important ★, Question ? …) from your notebooks.</div>
    ${win ? "" : '<div class="warn">Available when running on Windows.</div>'}`;

  const sel = IMP.tasks.filter((t) => t._on).length;
  const preview = IMP.tasks.length ? `
    <div class="form-row" style="margin-top:16px"><b>${IMP.tasks.length} tasks found</b><span class="hint">· untick anything you don't want · duplicates of earlier imports are skipped</span></div>
    <div class="preview-wrap"><table class="preview"><thead><tr><th><input type="checkbox" id="pAll" ${sel === IMP.tasks.length ? "checked" : ""}></th><th>Title</th><th>Status</th><th>Priority</th><th>Due</th><th>List</th><th>Labels</th></tr></thead>
    <tbody>${IMP.tasks.map((t, i) => `<tr><td><input type="checkbox" data-pi="${i}" ${t._on ? "checked" : ""}></td><td title="${esc(t.title)}">${esc(t.title)}</td>
      <td>${esc((STATUSES.find((s) => s.id === t.status) || STATUSES[0]).name)}</td><td>${esc(t.priority || "normal")}</td><td>${esc(t.due_date || "")}</td><td>${esc(t.list || "")}</td><td>${esc((t.labels || []).join(", "))}</td></tr>`).join("")}</tbody></table></div>` : "";

  $("#modal").innerHTML = `<div class="modal-head"><h2>Import tasks</h2><button class="icon-btn" id="mClose">✕</button></div>
    <div class="modal-body">
      <div class="src-tabs">${SOURCES.map((s) => `<button class="src-tab ${IMP.src === s.id ? "active" : ""}" data-src="${s.id}"><b>${s.name}</b><small>${s.desc}</small></button>`).join("")}</div>
      <div class="form-row"><label>Add to list</label><select class="input" id="impList">${lists}</select></div>
      ${form}
      ${IMP.error ? `<div class="err">${esc(IMP.error)}</div>` : ""}
      ${IMP.warnings.length ? `<div class="warn">${IMP.warnings.slice(0, 6).map(esc).join("<br>")}</div>` : ""}
      ${preview}
    </div>
    <div class="modal-foot">${IMP.busy ? '<span class="spinner"></span><span class="hint">Reading…</span>' : ""}<div class="spacer"></div>
      ${IMP.src !== "file" ? `<button class="btn" id="scanBtn" ${IMP.busy ? "disabled" : ""}>${IMP.src === "sharepoint" ? "Scan folder" : "Read " + SOURCES.find((s) => s.id === IMP.src).name}</button>` : ""}
      <button class="btn primary" id="doImport" ${sel && !IMP.busy ? "" : "disabled"}>Import ${sel || ""} task${sel === 1 ? "" : "s"}</button></div>`;
  bindImport();
}

function bindImport() {
  $("#mClose").onclick = closeModal;
  document.querySelectorAll("[data-src]").forEach((b) => b.onclick = () => { IMP.src = b.dataset.src; IMP.tasks = []; IMP.warnings = []; IMP.error = ""; renderImport(); });
  const target = () => $("#impList").value;
  const setResult = (r) => { IMP.tasks = r.tasks.map((t) => ({ ...t, _on: t.status !== "done" || IMP.src === "file" })); IMP.warnings = r.warnings || []; };
  const run = async (fn) => { IMP.busy = true; IMP.error = ""; renderImport(); try { await fn(); } catch (e) { IMP.error = e.message; } IMP.busy = false; renderImport(); };

  const drop = $("#drop");
  if (drop) {
    const input = $("#fileInput");
    drop.onclick = () => input.click();
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    const handle = (files) => run(async () => {
      const all = { tasks: [], warnings: [] };
      for (const f of files) {
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(f); });
        try {
          const r = await api("POST", "/api/import/file", { filename: f.name, content_b64: b64, list: target() });
          all.tasks.push(...r.tasks); all.warnings.push(...r.warnings.map((w) => `${f.name}: ${w}`));
          if (!r.tasks.length) all.warnings.push(`${f.name}: no tasks found`);
        } catch (e) { all.warnings.push(`${f.name}: ${e.message}`); }
      }
      setResult(all);
    });
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); handle([...e.dataTransfer.files]); };
    input.onchange = () => handle([...input.files]);
  }
  const sugg = $("#sugg");
  if (sugg) {
    api("GET", "/api/sharepoint/folders").then((r) => {
      if (r.folders.length) sugg.innerHTML = `<span class="hint">Synced folders on this PC:</span>` + r.folders.map((f) => `<button data-path="${esc(f)}">📁 ${esc(f)}</button>`).join("");
      sugg.querySelectorAll("[data-path]").forEach((b) => b.onclick = () => { $("#folderPath").value = b.dataset.path; });
    }).catch(() => {});
    const bb = $("#browseBtn");
    if (bb) bb.onclick = async () => { try { const r = await api("POST", "/api/pick-folder"); if (r.path) $("#folderPath").value = r.path; } catch (e) { toast(e.message, true); } };
  }
  const scan = $("#scanBtn");
  if (scan) scan.onclick = () => {
    if (IMP.src === "sharepoint") {
      const path = $("#folderPath").value, recursive = $("#recursive").checked;
      if (!path.trim()) { IMP.error = "Enter or choose a folder first."; return renderImport(); }
      return run(async () => { setResult(await api("POST", "/api/import/folder", { path, recursive, list: target() })); $("#folderPath") && ($("#folderPath").value = path); });
    }
    if (IMP.src === "outlook") {
      const body = { tasks: $("#oTasks").checked, flagged: $("#oFlag").checked, calendar: $("#oCal").checked, days: +$("#oDays").value || 14, list: target() };
      return run(async () => setResult(await api("POST", "/api/import/outlook", body)));
    }
    const body = { days: +$("#nDays").value || 30, include_done: $("#nDone").checked, list: target() };
    return run(async () => setResult(await api("POST", "/api/import/onenote", body)));
  };
  const all = $("#pAll");
  if (all) all.onchange = () => { IMP.tasks.forEach((t) => (t._on = all.checked)); renderImport(); };
  document.querySelectorAll("[data-pi]").forEach((c) => c.onchange = () => { IMP.tasks[+c.dataset.pi]._on = c.checked; renderImport(); });
  $("#doImport").onclick = async () => {
    const fallback = target() || S.list || S.data.lists[0];
    const items = IMP.tasks.filter((t) => t._on).map(({ _on, ...t }) => ({ ...t, list: target() || t.list || fallback }));
    try {
      const r = await api("POST", "/api/tasks/bulk", { tasks: items });
      closeModal(); await load();
      toast(`Imported ${r.created} task${r.created === 1 ? "" : "s"}${r.skipped ? ` · ${r.skipped} already imported` : ""}`);
    } catch (e) { toast(e.message, true); }
  };
}

/* ---------- lists ---------- */
async function meta(body) {
  const st = await api("POST", "/api/meta", body);
  S.data = { workspace: st.workspace, lists: st.lists, tasks: st.tasks }; render();
}
function listMenu(name, x, y) {
  closeMenu();
  const m = document.createElement("div");
  m.className = "menu"; m.id = "menu"; m.style.left = x + "px"; m.style.top = y + "px";
  m.innerHTML = `<button data-a="rename">✎ Rename</button><button data-a="delete" style="color:var(--danger)">🗑 Delete list</button>`;
  document.body.appendChild(m);
  m.onclick = async (e) => {
    const a = e.target.closest("button")?.dataset.a; closeMenu();
    if (a === "rename") { const to = prompt("Rename list", name); if (to && to.trim() && to !== name) { await meta({ rename_list: { from: name, to: to.trim() } }); if (S.list === name) { S.list = to.trim(); render(); } } }
    if (a === "delete" && confirm(`Delete list "${name}"? Its tasks move to "${S.data.lists.find((l) => l !== name) || "My Tasks"}".`)) { if (S.list === name) S.list = null; await meta({ delete_list: name }); }
  };
}
const closeMenu = () => { const m = $("#menu"); if (m) m.remove(); };

/* ---------- global wiring ---------- */
function wire() {
  $("#periodNav").addEventListener("click", (e) => {
    const it = e.target.closest("[data-period]"); if (!it) return;
    S.period = it.dataset.period; if (S.view === "home" || S.view === "calendar") S.view = "list"; render();
  });
  $("#periodChips").addEventListener("click", (e) => { const it = e.target.closest("[data-period]"); if (it) { S.period = it.dataset.period; render(); } });
  $("#listNav").addEventListener("click", (e) => {
    const mb = e.target.closest("[data-listmenu]");
    if (mb) { e.stopPropagation(); const r = mb.getBoundingClientRect(); return listMenu(mb.dataset.listmenu, r.left, r.bottom + 4); }
    const it = e.target.closest("[data-list]"); if (it) { S.list = it.dataset.list || null; render(); }
  });
  $("#addListBtn").onclick = async () => { const n = prompt("New list name (e.g. a client, project or territory)"); if (n && n.trim()) { await meta({ lists: [...S.data.lists, n.trim()] }); S.list = n.trim(); render(); } };
  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b) { S.view = b.dataset.view; render(); } });
  document.querySelectorAll(".rail-btn").forEach((b) => b.onclick = () => { if (b.dataset.nav === "import") return openImport(); S.view = b.dataset.nav; render(); });
  $("#search").addEventListener("input", (e) => { S.search = e.target.value; render(); });
  $("#prioFilter").onchange = (e) => { S.prio = e.target.value; render(); };
  $("#showDone").onchange = (e) => { S.showDone = e.target.checked; render(); };
  $("#newTaskBtn").onclick = () => { const r = periodRange(S.period); newTask(r ? { due_date: iso(r[0] < today() ? today() : r[0]) } : {}); };
  $("#importBtn").onclick = () => openImport();
  $("#openDataBtn").onclick = () => api("POST", "/api/open-data").then(() => toast("Opened data folder (tasks.json / tasks.csv / tasks.xlsx)")).catch((e) => toast(e.message, true));
  $("#workspaceBtn").onclick = async () => { const n = prompt("Workspace name", S.data.workspace); if (n && n.trim()) await meta({ workspace: n.trim() }); };
  $("#modalBack").addEventListener("mousedown", (e) => { if (e.target.id === "modalBack") closeModal(); });
  document.addEventListener("click", (e) => { if (!e.target.closest("#menu")) closeMenu(); });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#search").focus(); }
    if (e.key === "Escape") { closeMenu(); if ($("#modalBack").classList.contains("open")) closeModal(); else if (S.selected) closeDrawer(); }
    if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $("#newTaskBtn").click(); }
  });
  // keep the local server alive while this window is open
  const beat = () => fetch("/api/heartbeat", { method: "POST" }).catch(() => {});
  beat(); setInterval(beat, 15000);
  document.addEventListener("visibilitychange", beat);
}

wire();
load().catch((e) => { $("#content").innerHTML = `<div class="err">Could not reach the Task Tracker engine: ${esc(e.message)}. Close this window and start the app again.</div>`; });
