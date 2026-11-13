"use strict";

const chartStatus = document.getElementById("chart-status");
const chart = document.createElement("tv-advanced-chart");
chart.setAttribute("symbol", "BITSTAMP:BTCUSD");
chart.setAttribute("interval", "1D");
chart.setAttribute("timezone", "Etc/UTC");
chart.setAttribute("chart-type", "candles");
chart.setAttribute("hide-snapshot-button", "true");
chart.setAttribute("studies", JSON.stringify([
  {id: "MASimple@tv-basicstudies", inputs: {length: 50}},
  {id: "MASimple@tv-basicstudies", inputs: {length: 200}},
]));

function updateChartTheme() {
  chart.setAttribute("theme", document.documentElement.dataset.theme || "dark");
}
updateChartTheme();
window.addEventListener("themechange", updateChartTheme);
document.getElementById("price-chart").append(chart);

const script = document.createElement("script");
script.type = "module";
script.src = "https://widgets.tradingview-widget.com/w/en/tv-advanced-chart.js";
script.referrerPolicy = "no-referrer";
script.onerror = () => {
  chartStatus.hidden = false;
  chartStatus.textContent = "Chart unavailable. Open the TradingView link below to view prices.";
};
script.onload = () => {
  chartStatus.textContent = "If the chart is unavailable, open the TradingView link below.";
};
document.head.append(script);
