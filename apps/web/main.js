// Commit 5: add charts (line + bar) with payoff annotations and £-saved visual
let engine = null;

const $ = (sel) => document.querySelector(sel);
const fmtGBP = (n) =>
  (Number.isFinite(n) ? n : 0).toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 });
const clamp = (val, min, max) => Math.min(Math.max(val, min), max);
const addMonths = (date, m) => {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + m);
  if (d.getDate() < day) d.setDate(0);
  return d;
};
const formatMMMYYYY = (d) => d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });

// ---------- Elements ----------
const elTypeMortgage = $("#loanType-mortgage");
const elTypePersonal = $("#loanType-personal");
const elOutstanding = $("#outstandingBalance");
const elMonths = $("#remainingTermMonths");
const elApr = $("#interestApr");
const elOverpay = $("#overpayMonthly");
const elOverpayValue = document.querySelector(".range .value");

const outPayoffDate = $("#result-payoffDate");
const outInterestSaved = $("#result-interestSaved");
const outTotalInterest = $("#result-totalInterest");
const outMonthsSaved = $("#result-monthsSaved");

// Error banner
const elErrorBanner = $("#errorBanner");
const elErrorText = $("#errorText");
function showError(msg) { if (elErrorText) elErrorText.textContent = String(msg || "Invalid input."); elErrorBanner?.classList.remove("hidden"); }
function clearError() { if (elErrorText) elErrorText.textContent = ""; elErrorBanner?.classList.add("hidden"); }

// Status pill
const statusText = $("#statusText");
function setStatus(msg) { if (statusText) statusText.textContent = msg; }

// ---------- Placeholders ----------
const placeholders = {
  mortgage: { outstanding: "250000", months: "300", apr: "4.25", sliderMax: 5000, sliderStep: 50 },
  personal: { outstanding: "10000", months: "60",  apr: "9.9",  sliderMax: 1000, sliderStep: 25 }
};

// ---------- Charts state ----------
let balanceChart = null;
let interestChart = null;

// Register plugin if available (Chart injected by <script> tag)
if (window.Chart && window["chartjs-plugin-annotation"]) {
  window.Chart.register(window["chartjs-plugin-annotation"]);
}

// Dynamic import of engine so we can show a status if it fails
async function loadEngine() {
  try {
    engine = await import("../../packages/engine/dist/index.js");
    setStatus("loaded ✓");
  } catch (e) {
    setStatus("failed ✗");
    showError("Engine failed to load. Build it (pnpm -C packages/engine build) and serve from repo root.");
    console.error(e);
  }
}
loadEngine();

// ---------- UI logic ----------
function applyLoanTypeUI() {
  const type = elTypeMortgage.checked ? "mortgage" : "personal";
  const p = placeholders[type];

  elOutstanding.placeholder = p.outstanding;
  elMonths.placeholder = p.months;
  elApr.placeholder = p.apr;

  elOverpay.max = String(p.sliderMax);
  elOverpay.step = String(p.sliderStep);
  elOverpay.value = String(Math.min(Number(elOverpay.value || 0), p.sliderMax));
  elOverpayValue.textContent = fmtGBP(Number(elOverpay.value || 0));

  recompute();
}

function readInputs() {
  const outstanding = clamp(Number(elOutstanding.value || elOutstanding.placeholder || 0), 0, Number.MAX_SAFE_INTEGER);
  const months = Math.max(1, Math.floor(Number(elMonths.value || elMonths.placeholder || 1)));
  const apr = clamp(Number(elApr.value || elApr.placeholder || 0), 0, 1000);
  const overpay = clamp(Number(elOverpay.value || 0), 0, Number(elOverpay.max));

  if (Number(elOutstanding.value) !== outstanding) elOutstanding.value = String(outstanding);
  if (Number(elMonths.value) !== months) elMonths.value = String(months);
  if (Number(elApr.value) !== apr) elApr.value = String(apr);
  if (Number(elOverpay.value) !== overpay) elOverpay.value = String(overpay);

  return {
    outstandingBalance: outstanding,
    remainingTermMonths: months,
    aprPercent: apr,
    monthlyOverpayment: overpay
  };
}

let recomputeScheduled = false;
function scheduleRecompute() {
  if (recomputeScheduled) return;
  recomputeScheduled = true;
  queueMicrotask(() => { recomputeScheduled = false; recompute(); });
}

function clearOutputs() {
  outPayoffDate.textContent = "—";
  outInterestSaved.textContent = "—";
  outTotalInterest.textContent = "—";
  outMonthsSaved.textContent = "—";
  // Clear charts
  if (balanceChart) { balanceChart.data.labels = []; balanceChart.data.datasets.forEach(d => d.data = []); balanceChart.update(); }
  if (interestChart) { interestChart.data.labels = []; interestChart.data.datasets.forEach(d => d.data = []); interestChart.update(); }
}

// Build data for charts from engine result
function buildChartData(res, inputs) {
  // Labels are months (0..max)
  const maxMonths = Math.max(res.baseline.months, res.withOverpay.months);
  const labels = Array.from({ length: maxMonths + 1 }, (_, i) => i); // 0..N

  // Build balance series starting with initial outstanding, then each closing balance
  const startBalance = inputs.outstandingBalance;
  const baseSeries = [startBalance, ...res.baseline.schedule.map(e => e.closingBalance)];
  const overSeries = [startBalance, ...res.withOverpay.schedule.map(e => e.closingBalance)];

  // Pad with nulls to align lengths visually
  const padTo = (arr, len) => arr.concat(Array(Math.max(0, len - arr.length)).fill(null));
  const baseData = padTo(baseSeries, labels.length);
  const overData = padTo(overSeries, labels.length);

  // Dates for annotation labels
  const basePayoffDate = formatMMMYYYY(addMonths(new Date(), res.baseline.months));
  const overPayoffDate = formatMMMYYYY(addMonths(new Date(), res.withOverpay.months));

  return {
    labels,
    baseData,
    overData,
    baseMonths: res.baseline.months,
    overMonths: res.withOverpay.months,
    baseInterest: res.baseline.totalInterest,
    overInterest: res.withOverpay.totalInterest,
    basePayoffDate,
    overPayoffDate
  };
}

function upsertCharts(data) {
  const ctxLine = $("#balanceChart")?.getContext?.("2d");
  const ctxBar = $("#interestBarChart")?.getContext?.("2d");
  if (!window.Chart || !ctxLine || !ctxBar) return;

  const annotation = {
    annotations: {
      baseLine: {
        type: "line",
        xMin: data.baseMonths, xMax: data.baseMonths,
        borderColor: "rgba(239, 68, 68, .6)", borderWidth: 2, borderDash: [4,4],
        label: { enabled: true, position: "start", content: `Baseline payoff: ${data.basePayoffDate}` }
      },
      overLine: {
        type: "line",
        xMin: data.overMonths, xMax: data.overMonths,
        borderColor: "rgba(34, 197, 94, .7)", borderWidth: 2,
        label: { enabled: true, position: "start", content: `With overpay: ${data.overPayoffDate}` }
      }
    }
  };

  // Line chart: balance over time
  if (!balanceChart) {
    balanceChart = new window.Chart(ctxLine, {
      type: "line",
      data: {
        labels: data.labels,
        datasets: [
          { label: "Baseline balance", data: data.baseData, tension: 0.15, pointRadius: 0, borderWidth: 2 },
          { label: "With overpayment", data: data.overData, tension: 0.15, pointRadius: 0, borderWidth: 2 }
        ]
      },
      options: {
        responsive: true,
        animation: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { title: { display: true, text: "Months from now" } },
          y: {
            title: { display: true, text: "Outstanding balance (£)" },
            ticks: { callback: (v) => fmtGBP(v) }
          }
        },
        plugins: {
          legend: { display: true },
          tooltip: {
            callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtGBP(ctx.parsed.y)}` }
          },
          annotation
        }
      }
    });
  } else {
    balanceChart.data.labels = data.labels;
    balanceChart.data.datasets[0].data = data.baseData;
    balanceChart.data.datasets[1].data = data.overData;
    balanceChart.options.plugins.annotation = annotation;
    balanceChart.update();
  }

  // Bar chart: total interest comparison
  if (!interestChart) {
    interestChart = new window.Chart(ctxBar, {
      type: "bar",
      data: {
        labels: ["Total Interest (£)"],
        datasets: [
          { label: "Baseline", data: [data.baseInterest] },
          { label: "With overpayment", data: [data.overInterest] }
        ]
      },
      options: {
        responsive: true,
        animation: false,
        scales: {
          y: {
            title: { display: true, text: "£" },
            ticks: { callback: (v) => fmtGBP(v) },
            beginAtZero: true
          }
        },
        plugins: {
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtGBP(ctx.parsed.y)}` } },
          legend: { display: true }
        }
      }
    });
  } else {
    interestChart.data.datasets[0].data = [data.baseInterest];
    interestChart.data.datasets[1].data = [data.overInterest];
    interestChart.update();
  }
}

function recompute() {
  clearError();
  elOverpayValue.textContent = fmtGBP(Number(elOverpay.value || 0));
  if (!engine) return;

  const inputs = readInputs();
  if (!Number.isFinite(inputs.outstandingBalance) || inputs.outstandingBalance === 0) {
    clearOutputs();
    return;
  }

  try {
    const t0 = performance.now();
    const res = engine.calculateRepaymentJourney(inputs);

    const payoffDate = formatMMMYYYY(addMonths(new Date(), res.withOverpay.months));
    outPayoffDate.textContent = payoffDate;
    outInterestSaved.textContent = fmtGBP(res.interestSaved);
    outTotalInterest.textContent = fmtGBP(res.withOverpay.totalInterest);
    outMonthsSaved.textContent = String(res.monthsSaved);

    // charts
    const chartData = buildChartData(res, inputs);
    upsertCharts(chartData);

    const t1 = performance.now();
    setStatus?.(`loaded ✓ · last compute ${Math.round(t1 - t0)} ms`);
  } catch (e) {
    clearOutputs();
    showError(e?.message || "Could not compute results. Please check your inputs.");
  }
}

// Events
[elTypeMortgage, elTypePersonal].forEach((el) => el.addEventListener("change", applyLoanTypeUI));
[elOutstanding, elMonths, elApr].forEach((el) => {
  el.addEventListener("input", scheduleRecompute);
  el.addEventListener("change", scheduleRecompute);
});
elOverpay.addEventListener("input", scheduleRecompute);
elOverpay.addEventListener("change", scheduleRecompute);

// Boot
applyLoanTypeUI();
