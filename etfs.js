"use strict";

const SOURCE = "/api/etf-flows";
const chartPoints = new Map();
const status = document.getElementById("etf-status");
const refresh = document.getElementById("etf-refresh");
const usd = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 2});
const compactUsd = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2});
let days = [];
let range = "30";
let loading = false;
let checkedAt = null;
let failed = false;

function money(value, compact = false) {
  if (value === null) return "Unavailable";
  return (value > 0 ? "+" : "") + (compact ? compactUsd : usd).format(value);
}

function setValue(id, value, compact = false) {
  const element = document.getElementById(id);
  element.textContent = money(value, compact);
  element.className = value === null ? "" : value > 0 ? "positive" : value < 0 ? "negative" : "";
}

function parseDays(payload) {
  if (!payload || payload.units !== "USD" || !Array.isArray(payload.days) || !payload.days.length) {
    throw new Error("Invalid dataset");
  }
  const dates = new Set();
  return payload.days.map(row => {
    if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
        !Number.isFinite(Date.parse(row.date)) || new Date(row.date).toISOString().slice(0, 10) !== row.date || dates.has(row.date) ||
        !(row.netFlowUsd === null || Number.isFinite(row.netFlowUsd))) {
      throw new Error("Invalid daily record");
    }
    dates.add(row.date);
    const funds = row.perEtfUsd ?? {};
    if (typeof funds !== "object" || Array.isArray(funds) || Object.entries(funds).some(([ticker, value]) =>
      !/^[A-Z0-9.-]{1,15}$/.test(ticker) || !(value === null || Number.isFinite(value)))) {
      throw new Error("Invalid fund record");
    }
    return {date: row.date, flow: row.netFlowUsd, funds};
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function showStatus() {
  if (!checkedAt) return;
  const newest = days[days.length - 1].date;
  const old = Date.now() - Date.parse(newest + "T23:59:59Z") > 5 * 86400_000;
  status.textContent = (failed ? "Update unavailable. Retaining the last successful data. " : old ? "Source data may be stale. " : "") +
    "Data through " + newest + ". Checked " + new Date(checkedAt).toISOString().replace("T", " ").slice(0, 19) + " UTC.";
}

function appendRow(body, label, value, note = "") {
  const row = document.createElement("tr");
  const heading = document.createElement("th");
  heading.scope = "row";
  heading.textContent = label;
  const cell = document.createElement("td");
  cell.textContent = money(value);
  cell.className = value > 0 ? "positive" : value < 0 ? "negative" : "";
  if (note) {
    const small = document.createElement("small");
    small.textContent = note;
    cell.append(small);
  }
  row.append(heading, cell);
  body.append(row);
}

function renderData() {
  const latest = days[days.length - 1];
  const latestFunds = [...days].reverse().find(row => Object.keys(row.funds).length);
  const complete = days.every(row => row.flow !== null);
  const total = complete ? days.reduce((sum, row) => sum + row.flow, 0) : null;
  document.getElementById("data-through").textContent = latest.date;
  document.getElementById("daily-date").textContent = latest.date;
  document.getElementById("history-start").textContent = complete ? "Since " + days[0].date : "Full history contains missing figures";
  setValue("daily-flow", latest.flow, true);
  setValue("cumulative-flow", total, true);
  document.getElementById("fund-count").textContent = latestFunds ? Object.values(latestFunds.funds).filter(value => value !== null).length + " funds" : "Unavailable";
  document.getElementById("fund-date").textContent = latestFunds ? latestFunds.date : "No breakdown published";
  document.getElementById("fund-note").textContent = latestFunds ? "Source-reported breakdown · " + latestFunds.date : "No fund breakdown published";
  const fundRows = document.getElementById("fund-rows");
  fundRows.replaceChildren();
  if (latestFunds) {
    for (const [ticker, value] of Object.entries(latestFunds.funds).sort((a, b) => (b[1] ?? -Infinity) - (a[1] ?? -Infinity))) {
      appendRow(fundRows, ticker, value);
    }
  }
  const recentRows = document.getElementById("recent-rows");
  recentRows.replaceChildren();
  for (const row of days.slice(-15).reverse()) {
    appendRow(recentRows, row.date, row.flow,
      !Object.keys(row.funds).length ? "No fund breakdown published" : "");
  }
  const history = document.getElementById("history-rows");
  history.replaceChildren();
  let cumulative = 0;
  let completeHistory = true;
  for (const row of days) {
    if (row.flow === null) completeHistory = false;
    cumulative += row.flow ?? 0;
    appendRow(history, row.date, row.flow);
    const cell = document.createElement("td");
    cell.textContent = money(completeHistory ? cumulative : null);
    history.lastElementChild.append(cell);
  }
  renderCharts();
  showStatus();
}

function drawChart(id, points, bars) {
  chartPoints.set(id, points);
  const canvas = document.getElementById(id);
  canvas.nextElementSibling.textContent = "Hover, tap, or use arrow keys on the chart for exact values.";
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const scale = window.devicePixelRatio || 1;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  const valid = points.filter(point => point.value !== null);
  const colors = getComputedStyle(document.documentElement);
  ctx.font = "13px Segoe UI, Arial, sans-serif";
  ctx.fillStyle = colors.getPropertyValue("--muted").trim();
  if (!valid.length) {
    ctx.fillText("No values available for this range.", 18, 36);
    return;
  }
  const left = 78, right = width - 12, top = 22, bottom = height - 32;
  const min = Math.min(0, ...valid.map(point => point.value));
  const max = Math.max(0, ...valid.map(point => point.value));
  const span = max - min || 1;
  const y = value => bottom - (value - min) / span * (bottom - top);
  const x = index => left + (index + .5) / points.length * (right - left);
  for (let i = 0; i <= 4; i++) {
    const value = min + span * i / 4;
    if (bars && Math.abs(value) < span * .08) continue;
    ctx.strokeStyle = colors.getPropertyValue("--line").trim();
    ctx.beginPath(); ctx.moveTo(left, y(value)); ctx.lineTo(right, y(value)); ctx.stroke();
    ctx.fillStyle = colors.getPropertyValue("--muted").trim();
    ctx.fillText(compactUsd.format(value), 0, y(value) + 4);
  }
  if (bars) {
    ctx.strokeStyle = colors.getPropertyValue("--muted").trim();
    ctx.beginPath();
    ctx.moveTo(left, y(0));
    ctx.lineTo(right, y(0));
    ctx.stroke();
    ctx.fillText("$0", 0, y(0) + 4);
    const barWidth = Math.max(1, (right - left) / points.length * .7);
    points.forEach((point, i) => {
      if (point.value === null || point.value === 0) return;
      ctx.fillStyle = colors.getPropertyValue(point.value < 0 ? "--negative" : "--positive").trim();
      ctx.fillRect(x(i) - barWidth / 2, Math.min(y(point.value), y(0)), barWidth, Math.max(1, Math.abs(y(point.value) - y(0))));
    });
  } else {
    ctx.strokeStyle = colors.getPropertyValue("--accent").trim(); ctx.lineWidth = 2;
    ctx.beginPath();
    let drawing = false;
    points.forEach((point, i) => {
      if (point.value === null) { drawing = false; return; }
      if (drawing) ctx.lineTo(x(i), y(point.value)); else ctx.moveTo(x(i), y(point.value));
      drawing = true;
    });
    ctx.stroke();
  }
  ctx.fillStyle = colors.getPropertyValue("--muted").trim();
  ctx.fillText(points[0].date, left, height - 8);
  ctx.textAlign = "right";
  ctx.fillText(points[points.length - 1].date, right, height - 8);
}

function renderCharts() {
  if (!days.length) return;
  const cutoff = range === "all" ? -Infinity : Date.parse(days[days.length - 1].date) - Number(range) * 86400_000;
  const selected = days.filter(row => Date.parse(row.date) >= cutoff);
  const period = selected.length > 180 ? "monthly" : selected.length > 45 ? "weekly" : "daily";
  const grouped = [];
  for (const row of selected) {
    const date = new Date(row.date + "T00:00:00Z");
    if (period === "weekly") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const key = period === "monthly" ? row.date.slice(0, 7) : date.toISOString().slice(0, 10);
    let group = grouped[grouped.length - 1];
    if (!group || group.key !== key) {
      group = {key, date: row.date, end: row.date, value: 0};
      grouped.push(group);
    }
    group.end = row.date;
    group.value = row.flow === null || group.value === null ? null : group.value + row.flow;
  }
  document.getElementById("flow-history-title").textContent = period[0].toUpperCase() + period.slice(1) + " net flows";
  document.getElementById("daily-caption").textContent = "USD · " + selected[0].date + " to " + selected[selected.length - 1].date + ". Positive = inflow, negative = outflow.";
  document.getElementById("daily-chart").setAttribute("aria-label", period + " ETF net flows. Exact daily values appear in the expandable history table below.");
  drawChart("daily-chart", grouped, true);
  let total = 0;
  let complete = true;
  const cumulative = days.map(row => {
    if (row.flow === null) complete = false;
    total += row.flow ?? 0;
    return {date: row.date, value: complete ? total : null};
  });
  document.getElementById("cumulative-caption").textContent = "Running total since " + days[0].date + ". Missing values leave the subsequent cumulative total unavailable.";
  drawChart("cumulative-chart", cumulative, false);
}

async function loadData() {
  if (loading) return;
  loading = true;
  refresh.disabled = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(SOURCE, {signal: controller.signal});
    if (!response.ok) throw new Error("Source unavailable");
    days = parseDays(await response.json());
    checkedAt = Number(response.headers.get("X-Data-Checked-At")) || Date.now();
    failed = response.headers.get("X-Data-Stale") === "true";
    renderData();
  } catch {
    failed = true;
    if (days.length) showStatus();
    else status.textContent = "ETF data is unavailable. Please retry or visit TFTC using the source link below.";
  } finally {
    clearTimeout(timeout);
    loading = false;
    refresh.disabled = false;
  }
}

for (const canvas of document.querySelectorAll(".flow-chart")) {
  canvas.tabIndex = 0;
  let activeIndex = 0;
  function showPoint(index) {
    const points = chartPoints.get(canvas.id);
    if (!points?.length) return;
    activeIndex = Math.max(0, Math.min(points.length - 1, index));
    const point = points[activeIndex];
    const date = point.end && point.end !== point.date ? point.date + " to " + point.end : point.date;
    canvas.nextElementSibling.textContent = date + " | " + money(point.value);
  }
  canvas.addEventListener("pointermove", event => {
    const bounds = canvas.getBoundingClientRect();
    const points = chartPoints.get(canvas.id);
    if (!points?.length) return;
    showPoint(Math.floor((event.clientX - bounds.left - 78) / (bounds.width - 90) * points.length));
  });
  canvas.addEventListener("pointerdown", event => {
    const bounds = canvas.getBoundingClientRect();
    const points = chartPoints.get(canvas.id);
    if (points?.length) showPoint(Math.floor((event.clientX - bounds.left - 78) / (bounds.width - 90) * points.length));
  });
  canvas.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const count = chartPoints.get(canvas.id)?.length || 0;
    const index = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : activeIndex + (event.key === "ArrowRight" ? 1 : -1);
    showPoint(index);
  });
  canvas.addEventListener("focus", () => showPoint(activeIndex));
}
if (window.matchMedia("(max-width: 620px)").matches) {
  document.querySelectorAll(".tables-grid details").forEach(panel => panel.open = false);
}
refresh.addEventListener("click", loadData);
for (const button of document.querySelectorAll("[data-days]")) {
  button.addEventListener("click", () => {
    range = button.dataset.days;
    document.querySelectorAll("[data-days]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    renderCharts();
  });
}
window.addEventListener("themechange", renderCharts);
new ResizeObserver(renderCharts).observe(document.getElementById("daily-chart"));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && (checkedAt === null || Date.now() - checkedAt >= 900_000)) void loadData();
});
setInterval(() => { if (!document.hidden) void loadData(); }, 900_000);
void loadData();
