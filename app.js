"use strict";

const HALVING_HEIGHT = 1_050_000;
const CYCLE_START = 840_000;
const BLOCK_INTERVAL_MS = 600_000;
const SOURCE_URL = "/api/blocks";
const elements = {};
for (const id of ["days", "hours", "minutes", "seconds", "estimated-date", "block-height",
  "blocks-remaining", "progress", "progress-label", "source-status", "block-time", "feed-state",
  "feed-label", "refresh", "completion"]) {
  elements[id] = document.getElementById(id);
}
const countdown = document.querySelector(".countdown");
const numberFormat = new Intl.NumberFormat("en-US");
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});
let latestBlock = null;
let checkedAt = null;
let targetTime = null;
let sourceFailed = false;
let loading = false;

function utcTime(timestamp) {
  return new Date(timestamp).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function renderCountdown() {
  if (targetTime === null || latestBlock.height >= HALVING_HEIGHT) return;
  const seconds = Math.max(0, Math.floor((targetTime - Date.now()) / 1000));
  const values = [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24,
    Math.floor(seconds / 60) % 60, seconds % 60];
  ["days", "hours", "minutes", "seconds"].forEach((id, index) => {
    elements[id].textContent = String(values[index]).padStart(2, "0");
  });
}

function renderSource() {
  const stale = sourceFailed || (checkedAt !== null && Date.now() - checkedAt > 180_000) ||
    (latestBlock !== null && Date.now() - latestBlock.timestamp * 1000 > 86_400_000);
  elements["feed-state"].textContent = stale ? (latestBlock ? "STALE" : "UNAVAILABLE") : checkedAt ? "CONNECTED" : "CONNECTING";
  elements["feed-label"].className = "feed-state " + (stale ? "stale" : checkedAt ? "current" : "");
  const message = stale
    ? latestBlock
      ? "Block feed delayed. Showing the last observation, checked " + utcTime(checkedAt) + "."
      : "Block feed unavailable. Retrying every minute. You can also refresh."
    : checkedAt ? "Source checked " + utcTime(checkedAt) + "." : "Connecting to mempool.space for the latest block…";
  if (elements["source-status"].textContent !== message) elements["source-status"].textContent = message;
}

function renderBlock() {
  const remaining = Math.max(0, HALVING_HEIGHT - latestBlock.height);
  const progress = Math.min(210_000, Math.max(0, latestBlock.height - CYCLE_START));
  // Mainnet consensus halves the subsidy at each 210,000-block interval.
  // This date projection uses target spacing and the source block's timestamp.
  targetTime = latestBlock.timestamp * 1000 + remaining * BLOCK_INTERVAL_MS;
  elements["block-height"].textContent = numberFormat.format(latestBlock.height);
  elements["blocks-remaining"].textContent = numberFormat.format(remaining);
  elements.progress.value = progress;
  elements["progress-label"].textContent = (progress / 210_000 * 100).toFixed(1) + "%";
  elements["estimated-date"].textContent = remaining === 0 ? "Halving complete" : dateFormat.format(targetTime) + " · UTC";
  elements["block-time"].textContent = "Latest block timestamp " + utcTime(latestBlock.timestamp * 1000) + ".";
  elements.completion.hidden = remaining !== 0;
  countdown.hidden = remaining === 0;
  renderCountdown();
  renderSource();
}

async function refreshBlock() {
  if (loading) return;
  loading = true;
  elements.refresh.disabled = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(SOURCE_URL, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Block source unavailable");
    const blocks = await response.json();
    const block = Array.isArray(blocks) ? blocks[0] : null;
    if (!block || !Number.isSafeInteger(block.height) || block.height < CYCLE_START ||
        !Number.isSafeInteger(block.timestamp) || block.timestamp <= 0 ||
        block.timestamp * 1000 > Date.now() + 7_200_000) {
      throw new Error("Invalid source response");
    }
    latestBlock = {height: block.height, timestamp: block.timestamp};
    checkedAt = Number(response.headers.get("X-Data-Checked-At")) || Date.now();
    sourceFailed = response.headers.get("X-Data-Stale") === "true";
    renderBlock();
  } catch {
    sourceFailed = true;
    renderSource();
  } finally {
    clearTimeout(timeout);
    loading = false;
    elements.refresh.disabled = false;
  }
}

elements.refresh.addEventListener("click", refreshBlock);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && (checkedAt === null || Date.now() - checkedAt >= 60_000)) void refreshBlock();
});
setInterval(() => {
  if (!document.hidden) {
    renderCountdown();
    renderSource();
  }
}, 1000);
setInterval(() => { if (!document.hidden) void refreshBlock(); }, 60_000);
void refreshBlock();
