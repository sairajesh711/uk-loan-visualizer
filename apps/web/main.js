// UK Loan Visualizer - Implementing exact data contract specifications
let engine = null;

// DOM helpers
const $ = (sel) => document.querySelector(sel);
const fmtGBP = (n) =>
  (Number.isFinite(n) ? n : 0).toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  });
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const addMonths = (d, m) => {
  const x = new Date(d.getTime());
  const day = x.getDate();
  x.setMonth(x.getMonth() + m);
  if (x.getDate() < day) x.setDate(0);
  return x;
};
const formatMMMYYYY = (d) =>
  d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });

// Try to read required payment from engine schedule; else compute from formula
function getRequiredMonthlyPayment(res, inputs) {
  const fromSchedule = res?.baseline?.schedule?.[0]?.requiredPayment;
  if (Number.isFinite(fromSchedule) && fromSchedule > 0) return fromSchedule;

  const P = inputs.outstandingBalance;
  const n = inputs.remainingTermMonths;
  const apr = Math.max(0, inputs.aprPercent) / 100;
  const r = Math.pow(1 + apr, 1 / 12) - 1; // effective monthly
  if (r === 0) return P / n;
  return (P * r) / (1 - Math.pow(1 + r, -n));
}

// Elements
const elTypeMortgage = $("#loanType-mortgage");
const elTypePersonal = $("#loanType-personal");
const elOutstanding = $("#outstandingBalance");
const elMonths = $("#remainingTermMonths");
const elApr = $("#interestApr");
const elOverpay = $("#overpayMonthly");
const elOverpayValue = $("#overpayValue");
const elExpectedReturn = $("#expectedReturn");
const elExpectedReturnValue = $("#expectedReturnValue");
const elRecommendedRate = $("#recommendedRate");

// Result elements
const outPayoffDate = $("#result-payoffDate");
const outInterestSaved = $("#result-interestSaved");
const outTotalInterest = $("#result-totalInterest");
const outMonthsSaved = $("#result-monthsSaved");
const outFvInvest = $("#result-fvInvest");
const outDeltaSimple = $("#result-deltaSimple");

// Chip elements
const chipOriginal = $("#chip-originalPayoff");
const chipMonthlyOutflow = $("#chip-monthlyOutflow");
const chipExpected = $("#chip-expectedReturn");
const chipCrossover = $("#chip-crossover");

// Error/status
const elErrorBanner = $("#errorBanner");
const elErrorText = $("#errorText");
const statusText = $("#statusText");
function showError(msg) {
  if (elErrorText) elErrorText.textContent = String(msg || "Invalid input.");
  elErrorBanner?.classList.remove("d-none");
}
function clearError() {
  if (elErrorText) elErrorText.textContent = "";
  elErrorBanner?.classList.add("d-none");
}
function setStatus(msg) {
  if (statusText) statusText.textContent = msg;
}

// Placeholders & recommended rate
const placeholders = {
  mortgage: { outstanding: "250000", months: "300", apr: "4.25", sliderMax: 5000, sliderStep: 50 },
  personal: { outstanding: "10000", months: "60", apr: "9.9", sliderMax: 1000, sliderStep: 25 },
};
const DEFAULT_RECOMMENDED_RATE = 4.0;
function applyRecommendedRate() {
  if (elRecommendedRate)
    elRecommendedRate.textContent = `${DEFAULT_RECOMMENDED_RATE.toFixed(1)}%`;
  if (!elExpectedReturn?.dataset.setOnce) {
    elExpectedReturn.value = String(DEFAULT_RECOMMENDED_RATE);
    if (elExpectedReturnValue)
      elExpectedReturnValue.textContent = `${DEFAULT_RECOMMENDED_RATE.toFixed(1)}%`;
    elExpectedReturn.dataset.setOnce = "1";
  }
}

// Register Chart.js annotation plugin
if (window.Chart && window["chartjs-plugin-annotation"]) {
  window.Chart.register(window["chartjs-plugin-annotation"]);
}

// Align Chart.js typography/colors with Bootstrap (if present)
try {
  if (window.Chart) {
    const s = getComputedStyle(document.body);
    const bsFont = s.getPropertyValue("--bs-body-font-family")?.trim();
    const bsColor = s.getPropertyValue("--bs-body-color")?.trim();
    if (bsFont) window.Chart.defaults.font.family = bsFont;
    if (bsColor) window.Chart.defaults.color = bsColor;
  }
} catch {}

// Chart references
let balanceChart = null;
let interestChart = null;
let oppLineChart = null;
let oppBarChart = null;
let deltaChart = null;

// Load engine (use absolute path so base/redirects don't break us)
async function loadEngine() {
  try {
    engine = await import("/packages/engine/dist/index.js");
    setStatus("loaded ✓");
  } catch (e) {
    setStatus("failed ✗");
    showError("Engine failed to load. Build it and serve from repo root.");
    console.error(e);
  }
}
loadEngine();

// UI logic
function applyLoanTypeUI() {
  const type = elTypeMortgage?.checked ? "mortgage" : "personal";
  const p = placeholders[type];
  elOutstanding.placeholder = p.outstanding;
  elMonths.placeholder = p.months;
  elApr.placeholder = p.apr;
  elOverpay.max = String(p.sliderMax);
  elOverpay.step = String(p.sliderStep);
  elOverpay.value = String(Math.min(Number(elOverpay.value || 0), p.sliderMax));
  if (elOverpayValue) elOverpayValue.textContent = fmtGBP(Number(elOverpay.value || 0));
  applyRecommendedRate();
  recompute();
}

function readInputs() {
  const outstanding = clamp(Number(elOutstanding.value || elOutstanding.placeholder || 0), 0, Number.MAX_SAFE_INTEGER);
  const months = Math.max(1, Math.floor(Number(elMonths.value || elMonths.placeholder || 1)));
  const apr = clamp(Number(elApr.value || elApr.placeholder || 0), 0, 1000);
  const overpay = clamp(Number(elOverpay.value || 0), 0, Number(elOverpay.max));
  const expectedReturn = clamp(Number(elExpectedReturn.value || 0), 0, 100);

  // normalize DOM to validated values
  if (Number(elOutstanding.value) !== outstanding) elOutstanding.value = String(outstanding);
  if (Number(elMonths.value) !== months) elMonths.value = String(months);
  if (Number(elApr.value) !== apr) elApr.value = String(apr);
  if (Number(elOverpay.value) !== overpay) elOverpay.value = String(overpay);

  return {
    outstandingBalance: outstanding,
    remainingTermMonths: months,
    aprPercent: apr,
    monthlyOverpayment: overpay,
    expectedAnnualReturnPercent: expectedReturn,
  };
}

let recomputeScheduled = false;
function scheduleRecompute() {
  if (recomputeScheduled) return;
  recomputeScheduled = true;
  queueMicrotask(() => {
    recomputeScheduled = false;
    recompute();
  });
}

function clearOutputs() {
  outPayoffDate.textContent = "—";
  outInterestSaved.textContent = "—";
  outTotalInterest.textContent = "—";
  outMonthsSaved.textContent = "—";
  outFvInvest.textContent = "—";
  outDeltaSimple.textContent = "—";

  // Clear charts
  if (balanceChart) {
    balanceChart.data.labels = [];
    balanceChart.data.datasets.forEach((d) => (d.data = []));
    balanceChart.update();
  }
  if (interestChart) {
    interestChart.data.labels = [];
    interestChart.data.datasets.forEach((d) => (d.data = []));
    interestChart.update();
  }
  if (oppLineChart) {
    oppLineChart.data.labels = [];
    oppLineChart.data.datasets.forEach((d) => (d.data = []));
    oppLineChart.update();
  }
  if (oppBarChart) {
    oppBarChart.data.labels = [];
    oppBarChart.data.datasets.forEach((d) => (d.data = []));
    oppBarChart.update();
  }
  if (deltaChart) {
    deltaChart.data.labels = [];
    deltaChart.data.datasets.forEach((d) => (d.data = []));
    deltaChart.update();
  }
}

// Build payoff series (for line chart + interest comparison)
function buildPayoffSeries(res) {
  const maxMonths = Math.max(res.baseline.months, res.withOverpay.months);
  const labels = Array.from({ length: maxMonths + 1 }, (_, i) => i);

  const initialBalance =
    res.baseline.schedule[0]?.openingBalance ??
    res.withOverpay.schedule[0]?.openingBalance ??
    0;

  const baselineBalances = [initialBalance, ...res.baseline.schedule.map((e) => e.closingBalance)];
  const overpayBalances = [initialBalance, ...res.withOverpay.schedule.map((e) => e.closingBalance)];

  while (baselineBalances.length < labels.length) baselineBalances.push(null);
  while (overpayBalances.length < labels.length) overpayBalances.push(null);

  return {
    labels,
    baselineBalances,
    overpayBalances,
    baselineMonths: res.baseline.months,
    overpayMonths: res.withOverpay.months,
    baselineSchedule: res.baseline.schedule,
    overpaySchedule: res.withOverpay.schedule,
  };
}

// Invest vs overpay series
function monthlyRateFromAnnual(annualPercent) {
  const annual = clamp(Number(annualPercent) || 0, 0, 100) / 100;
  return Math.pow(1 + annual, 1 / 12) - 1;
}
function buildOpportunitySeries(res, inputs, sensDelta = 2) {
  const n = res.baseline.months;
  const monthlyOverpayment = inputs.monthlyOverpayment;
  const expectedReturn = inputs.expectedAnnualReturnPercent;

  const r = monthlyRateFromAnnual(expectedReturn);
  const invested = [];
  let pot = 0;
  for (let t = 0; t < n; t++) {
    pot = pot * (1 + r) + monthlyOverpayment;
    invested.push(pot);
  }

  const rLow = monthlyRateFromAnnual(Math.max(0, expectedReturn - sensDelta));
  const rHigh = monthlyRateFromAnnual(expectedReturn + sensDelta);

  const investedLow = [];
  const investedHigh = [];
  let potLow = 0;
  let potHigh = 0;

  for (let t = 0; t < n; t++) {
    potLow = potLow * (1 + rLow) + monthlyOverpayment;
    potHigh = potHigh * (1 + rHigh) + monthlyOverpayment;
    investedLow.push(potLow);
    investedHigh.push(potHigh);
  }

  const cumSaved = [];
  let cumulative = 0;
  for (let t = 0; t < n; t++) {
    const baselineInterest = res.baseline.schedule[t]?.interest || 0;
    const overpayInterest = res.withOverpay.schedule[t]?.interest || 0;
    cumulative += baselineInterest - overpayInterest;
    cumSaved.push(cumulative);
  }

  let crossoverIndex = -1;
  for (let i = 0; i < n; i++) {
    if (invested[i] >= cumSaved[i]) {
      crossoverIndex = i;
      break;
    }
  }

  return {
    labels: Array.from({ length: n }, (_, i) => i + 1),
    invested,
    investedLow,
    investedHigh,
    cumSaved,
    crossoverIndex,
    FV: invested[n - 1] || 0,
    FVlow: investedLow[n - 1] || 0,
    FVhigh: investedHigh[n - 1] || 0,
    interestSavedFinal: cumSaved[n - 1] || 0,
  };
}

function buildFairHorizonSeries(res, inputs, sensDelta = 2) {
  const N = res.baseline.months;
  const M = res.withOverpay.months;
  const R = getRequiredMonthlyPayment(res, inputs);
  const O = inputs.monthlyOverpayment;

  const rateFromAnnual = a => Math.pow(1 + Math.max(0, a)/100, 1/12) - 1;
  const rBase = rateFromAnnual(inputs.expectedAnnualReturnPercent);
  const rLow  = rateFromAnnual(Math.max(0, inputs.expectedAnnualReturnPercent - sensDelta));
  const rHigh = rateFromAnnual(inputs.expectedAnnualReturnPercent + sensDelta);

  const fvCurve = (r) => {
    let potInvest = 0, potOverpay = 0;
    const invest = [], overpay = [], delta = [];
    for (let t = 1; t <= N; t++) {
      // Invest path contributes O every month
      potInvest = potInvest * (1 + r) + O;
      // Overpay path contributes 0 until payoff, then R+O
      const contribOverpay = (t <= M) ? 0 : (R + O);
      potOverpay = potOverpay * (1 + r) + contribOverpay;

      invest.push(potInvest);
      overpay.push(potOverpay);
      delta.push(potOverpay - potInvest);
    }
    // crossover: first t where delta >= 0
    let cross = -1;
    for (let i = 0; i < N; i++) if (delta[i] >= 0) { cross = i + 1; break; }
    return { invest, overpay, delta, crossoverMonth: cross };
  };

  const base  = fvCurve(rBase);
  const low   = fvCurve(rLow);
  const high  = fvCurve(rHigh);

  return {
    labels: Array.from({ length: N }, (_, i) => i + 1),
    invest: base.invest,
    overpay: base.overpay,
    delta: base.delta,
    crossoverMonth: base.crossoverMonth,
    investLow: low.invest,  overpayLow: low.overpay,
    investHigh: high.invest, overpayHigh: high.overpay,
    atN: {
      invest: base.invest[N-1],
      overpay: base.overpay[N-1],
      investLow: low.invest[N-1],
      overpayLow: low.overpay[N-1],
      investHigh: high.invest[N-1],
      overpayHigh: high.overpay[N-1],
    }
  };
}

// Charts
function upsertBalanceChart(series) {
  const ctx = $("#balanceChart")?.getContext?.("2d");
  if (!ctx || !window.Chart) return;

  const annotations = {
    baselinePayoff: {
      type: "line",
      xMin: series.baselineMonths,
      xMax: series.baselineMonths,
      borderColor: "rgba(239, 68, 68, 0.7)",
      borderWidth: 2,
      label: { enabled: true, content: `Original: ${formatMMMYYYY(addMonths(new Date(), series.baselineMonths))}` },
    },
    overpayPayoff: {
      type: "line",
      xMin: series.overpayMonths,
      xMax: series.overpayMonths,
      borderColor: "rgba(34, 197, 94, 0.7)",
      borderWidth: 2,
      label: { enabled: true, content: `Overpay: ${formatMMMYYYY(addMonths(new Date(), series.overpayMonths))}` },
    },
  };

  if (!balanceChart) {
    balanceChart = new window.Chart(ctx, {
      type: "line",
      data: {
        labels: series.labels,
        datasets: [
          { label: "Baseline balance", data: series.baselineBalances, tension: 0.15, pointRadius: 0, borderWidth: 2, borderColor: "rgb(239, 68, 68)", backgroundColor: "rgba(239, 68, 68, 0.1)" },
          { label: "With overpayment", data: series.overpayBalances, tension: 0.15, pointRadius: 0, borderWidth: 2, borderColor: "rgb(34, 197, 94)", backgroundColor: "rgba(34, 197, 94, 0.1)" },
        ],
      },
      options: {
        responsive: true, animation: false, interaction: { mode: "index", intersect: false },
        scales: {
          x: { title: { display: true, text: "Months from now" } },
          y: { title: { display: true, text: "Outstanding balance (£)" }, ticks: { callback: (v) => fmtGBP(v) } },
        },
        plugins: {
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtGBP(ctx.parsed.y)}` } },
          legend: { display: true },
          annotation: { annotations },
        },
      },
    });
  } else {
    balanceChart.data.labels = series.labels;
    balanceChart.data.datasets[0].data = series.baselineBalances;
    balanceChart.data.datasets[1].data = series.overpayBalances;
    balanceChart.options.plugins.annotation = { annotations };
    balanceChart.update();
  }
}

function upsertInterestChart(series) {
  const ctx = $("#interestBarChart")?.getContext?.("2d");
  if (!ctx || !window.Chart) return;

  const months = Math.min(24, series.baselineMonths);
  const labels = Array.from({ length: months }, (_, i) => `Month ${i + 1}`);
  const baselineInterest = [];
  const overpayInterest = [];
  for (let i = 0; i < months; i++) {
    baselineInterest.push(series.baselineSchedule?.[i]?.interest || 0);
    overpayInterest.push(series.overpaySchedule?.[i]?.interest || 0);
  }

  if (!interestChart) {
    interestChart = new window.Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Interest (baseline)", data: baselineInterest, backgroundColor: "rgba(239, 68, 68, 0.6)", borderColor: "rgb(239, 68, 68)", borderWidth: 1 },
          { label: "Interest (with overpay)", data: overpayInterest, backgroundColor: "rgba(34, 197, 94, 0.6)", borderColor: "rgb(34, 197, 94)", borderWidth: 1 },
        ],
      },
      options: {
        responsive: true, animation: false,
        scales: { x: { title: { display: true, text: "First 24 months" } }, y: { title: { display: true, text: "Monthly Interest (£)" }, ticks: { callback: (v) => fmtGBP(v) }, beginAtZero: true } },
        plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtGBP(ctx.parsed.y)}` } }, legend: { display: true } },
      },
    });
  } else {
    interestChart.data.labels = labels;
    interestChart.data.datasets[0].data = baselineInterest;
    interestChart.data.datasets[1].data = overpayInterest;
    interestChart.update();
  }
}

function upsertOppLineChart(series) {
  const ctx = $("#oppLineChart")?.getContext?.("2d");
  if (!ctx || !window.Chart) return;

  const annotation =
    series.crossoverMonth >= 0
      ? {
          annotations: {
            crossover: {
              type: "line", xMin: series.crossoverMonth, xMax: series.crossoverMonth,
              borderColor: "rgba(234, 179, 8, 0.7)", borderWidth: 2,
              label: { enabled: true, position: "start", content: `Crossover: month ${series.crossoverMonth}` },
            },
          },
        }
      : { annotations: {} };

  if (!oppLineChart) {
    oppLineChart = new window.Chart(ctx, {
      type: "line",
      data: {
        labels: series.labels,
        datasets: [
          { label: "Pot(Invest) - low", data: series.investLow, borderWidth: 0, fill: "+1", backgroundColor: "rgba(59, 130, 246, 0.1)", borderColor: "rgba(59, 130, 246, 0.3)", pointRadius: 0, tension: 0.15 },
          { label: "Pot(Invest) - high", data: series.investHigh, borderWidth: 0, fill: false, backgroundColor: "rgba(59, 130, 246, 0.1)", borderColor: "rgba(59, 130, 246, 0.3)", pointRadius: 0, tension: 0.15 },
          { label: "Pot(Invest)", data: series.invest, tension: 0.15, pointRadius: 0, borderWidth: 2, borderColor: "rgb(59, 130, 246)", backgroundColor: "rgba(59, 130, 246, 0.1)", fill: false },
          { label: "Pot(Overpay)", data: series.overpay, tension: 0.15, pointRadius: 0, borderWidth: 2, borderColor: "rgb(34, 197, 94)", backgroundColor: "rgba(34, 197, 94, 0.1)", fill: false },
        ],
      },
      options: {
        responsive: true, animation: false, interaction: { mode: "index", intersect: false },
        scales: { x: { title: { display: true, text: "Months (original term)" } }, y: { title: { display: true, text: "£" }, ticks: { callback: (v) => fmtGBP(v) }, beginAtZero: true } },
        plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtGBP(ctx.parsed.y)}` } }, legend: { display: true, labels: { filter: (li) => !li.text.includes("- low") && !li.text.includes("- high") } }, annotation },
      },
    });
  } else {
    oppLineChart.data.labels = series.labels;
    oppLineChart.data.datasets[0].data = series.investLow;
    oppLineChart.data.datasets[1].data = series.investHigh;
    oppLineChart.data.datasets[2].data = series.invest;
    oppLineChart.data.datasets[3].data = series.overpay;
    oppLineChart.options.plugins.annotation = annotation;
    oppLineChart.update();
  }
}

function upsertDeltaChart(series) {
  const ctx = $("#deltaChart")?.getContext?.("2d");
  if (!ctx || !window.Chart) return;

  const annotation = {
    annotations: {
      zeroLine: {
        type: "line", yMin: 0, yMax: 0,
        borderColor: "rgba(148, 163, 184, 0.5)", borderWidth: 1, borderDash: [5, 5],
        label: { enabled: true, content: "Break-even", position: "end" },
      },
    },
  };

  if (series.crossoverMonth >= 0) {
    annotation.annotations.crossover = {
      type: "line", xMin: series.crossoverMonth, xMax: series.crossoverMonth,
      borderColor: "rgba(234, 179, 8, 0.7)", borderWidth: 2,
      label: { enabled: true, content: `Crossover: month ${series.crossoverMonth}`, position: "start" },
    };
  }

  if (!deltaChart) {
    deltaChart = new window.Chart(ctx, {
      type: "line",
      data: {
        labels: series.labels,
        datasets: [
          { 
            label: "Δt (Overpay - Invest)", 
            data: series.delta, 
            tension: 0.15, 
            pointRadius: 0, 
            borderWidth: 2, 
            borderColor: "rgb(168, 85, 247)", 
            backgroundColor: "rgba(168, 85, 247, 0.1)", 
            fill: 'origin'
          },
        ],
      },
      options: {
        responsive: true, 
        animation: false, 
        interaction: { mode: "index", intersect: false },
        scales: { 
          x: { title: { display: true, text: "Months" } }, 
          y: { 
            title: { display: true, text: "£ Difference" }, 
            ticks: { callback: (v) => fmtGBP(v) },
            grid: { color: (context) => context.tick.value === 0 ? "rgba(148, 163, 184, 0.3)" : "rgba(148, 163, 184, 0.1)" }
          } 
        },
        plugins: { 
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtGBP(ctx.parsed.y)}` } }, 
          legend: { display: true },
          annotation 
        },
      },
    });
  } else {
    deltaChart.data.labels = series.labels;
    deltaChart.data.datasets[0].data = series.delta;
    deltaChart.options.plugins.annotation = annotation;
    deltaChart.update();
  }
}

function upsertOppBarChart(series) {
  const ctx = $("#oppBarChart")?.getContext?.("2d");
  if (!ctx || !window.Chart) return;

  if (!oppBarChart) {
    oppBarChart = new window.Chart(ctx, {
      type: "bar",
      data: {
        labels: ["At Original Term End"],
        datasets: [
          { label: "Pot(Invest) - low", data: [series.atN.investLow], backgroundColor: "rgba(59, 130, 246, 0.2)", borderColor: "rgba(59, 130, 246, 0.3)", borderWidth: 1 },
          { label: "Pot(Invest) - high", data: [series.atN.investHigh], backgroundColor: "rgba(59, 130, 246, 0.2)", borderColor: "rgba(59, 130, 246, 0.3)", borderWidth: 1 },
          { label: "Pot(Overpay) - low", data: [series.atN.overpayLow], backgroundColor: "rgba(34, 197, 94, 0.2)", borderColor: "rgba(34, 197, 94, 0.3)", borderWidth: 1 },
          { label: "Pot(Overpay) - high", data: [series.atN.overpayHigh], backgroundColor: "rgba(34, 197, 94, 0.2)", borderColor: "rgba(34, 197, 94, 0.3)", borderWidth: 1 },
          { label: "Pot(Overpay)", data: [series.atN.overpay], backgroundColor: "rgba(34, 197, 94, 0.6)", borderColor: "rgb(34, 197, 94)", borderWidth: 1 },
          { label: "Pot(Invest)", data: [series.atN.invest], backgroundColor: "rgba(59, 130, 246, 0.6)", borderColor: "rgb(59, 130, 246)", borderWidth: 1 },
        ],
      },
      options: {
        responsive: true, animation: false,
        scales: { y: { title: { display: true, text: "£" }, ticks: { callback: (v) => fmtGBP(v) }, beginAtZero: true } },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const label = ctx.dataset.label;
                const value = fmtGBP(ctx.parsed.y);
                if (label.includes("- low") || label.includes("- high")) return `${label}: ${value} (±2% sensitivity)`;
                return `${label}: ${value}`;
              },
            },
          },
          legend: { display: true, labels: { filter: (li) => !li.text.includes("- low") && !li.text.includes("- high") } },
        },
      },
    });
  } else {
    oppBarChart.data.datasets[0].data = [series.atN.investLow];
    oppBarChart.data.datasets[1].data = [series.atN.investHigh];
    oppBarChart.data.datasets[2].data = [series.atN.overpayLow];
    oppBarChart.data.datasets[3].data = [series.atN.overpayHigh];
    oppBarChart.data.datasets[4].data = [series.atN.overpay];
    oppBarChart.data.datasets[5].data = [series.atN.invest];
    oppBarChart.update();
  }
}

// Unified recommendation (fix sign, no duplicate definitions)
function updateRecommendation(res, inputs) {
  const badge = $("#recommendBadge");
  const title = $("#recommendTitle");
  const reasons = $("#recommendReasons");

  if (!badge || !title || !reasons) return;

  if (!res) {
    badge.textContent = "Recommendation";
    badge.className = "badge";
    title.textContent = "—";
    reasons.innerHTML = "";
    return;
  }

  const delta = res.invest?.deltaVsOverpaySimple ?? 0; // +ve: invest better by £
  const interestSaved = res.interestSaved ?? Math.max(0, (res.baseline?.totalInterest || 0) - (res.withOverpay?.totalInterest || 0));
  const fvInvest = res.invest?.fvInvest ?? 0;
  const expectedReturn = inputs.expectedAnnualReturnPercent;
  const loanApr = inputs.aprPercent;

  let recTitle = "";
  let badgeClass = "badge";
  const bullets = [];
  const EPS = 1000; // avoid flip-flop on tiny differences

  if (Math.abs(delta) < EPS) {
    recTitle = "Similar outcomes";
    badgeClass = "badge badge-neutral";
    bullets.push("Both strategies land within ~£1k by the end date");
    bullets.push(`Overpay saves ${fmtGBP(interestSaved)} and ends ${res.monthsSaved} months earlier`);
    if (fvInvest) bullets.push(`Investing could reach ${fmtGBP(fvInvest)} at ${expectedReturn.toFixed(1)}%/yr`);
  } else if (delta > 0) {
    recTitle = "Consider investing";
    badgeClass = "badge badge-invest";
    bullets.push(`Potentially ${fmtGBP(delta)} more than overpaying by the end date`);
    if (expectedReturn > loanApr + 1) bullets.push("Expected return materially exceeds loan APR");
    bullets.push("Keep liquidity/risk in mind; use tax shelters if eligible");
  } else {
    recTitle = "Consider overpaying";
    badgeClass = "badge badge-overpay";
    bullets.push(`Saves ${fmtGBP(-delta)} more than investing by the end date`);
    bullets.push(`Total interest avoided: ${fmtGBP(interestSaved)}; finish ${res.monthsSaved} months earlier`);
    bullets.push("This is a guaranteed return via debt reduction");
  }

  badge.textContent = "Recommendation";
  badge.className = badgeClass;
  title.textContent = recTitle;
  reasons.innerHTML = bullets.map((b) => `<li>${b}</li>`).join("");
}

// Main compute
function recompute() {
  clearError();
  if (elOverpayValue) elOverpayValue.textContent = fmtGBP(Number(elOverpay.value || 0));
  if (elExpectedReturnValue)
    elExpectedReturnValue.textContent = `${Number(elExpectedReturn.value || 0).toFixed(1)}%`;
  if (!engine) return;

  const inputs = readInputs();
  if (!Number.isFinite(inputs.outstandingBalance) || inputs.outstandingBalance === 0) {
    clearOutputs();
    updateRecommendation(null, inputs);
    return;
  }

  try {
    const t0 = performance.now();
    const res = engine.calculateRepaymentJourney(inputs);

    // Top KPIs
    const payoffDate = formatMMMYYYY(addMonths(new Date(), res.withOverpay.months));
    outPayoffDate.textContent = payoffDate;
    outInterestSaved.textContent = fmtGBP(res.interestSaved);
    outTotalInterest.textContent = fmtGBP(res.withOverpay.totalInterest);
    outMonthsSaved.textContent = String(res.monthsSaved);

    if (res.invest) {
      outFvInvest.textContent = fmtGBP(res.invest.fvInvest);
      outDeltaSimple.textContent = fmtGBP(res.invest.deltaVsOverpaySimple);
    } else {
      outFvInvest.textContent = "—";
      outDeltaSimple.textContent = "—";
    }

    // Chips
    const originalPayoffDate = formatMMMYYYY(addMonths(new Date(), res.baseline.months));
    if (chipOriginal) chipOriginal.textContent = `Original: ${originalPayoffDate}`;
    const requiredMonthly = getRequiredMonthlyPayment(res, inputs);
    const newOutflow = requiredMonthly + inputs.monthlyOverpayment;
    if (chipMonthlyOutflow) chipMonthlyOutflow.textContent = fmtGBP(newOutflow);
    if (chipExpected) chipExpected.textContent = `${inputs.expectedAnnualReturnPercent.toFixed(1)}%`;

    // Charts
    const payoffSeries = buildPayoffSeries(res);
    upsertBalanceChart(payoffSeries);
    upsertInterestChart(payoffSeries);

    const fairSeries = buildFairHorizonSeries(res, inputs);
    upsertOppLineChart(fairSeries);
    upsertDeltaChart(fairSeries);
    upsertOppBarChart(fairSeries);
    if (chipCrossover) {
      chipCrossover.textContent =
        fairSeries.crossoverMonth >= 0 ? `Crossover: month ${fairSeries.crossoverMonth}` : "Crossover: not within term";
    }

    // Recommendation
    updateRecommendation(res, inputs);

    const t1 = performance.now();
    setStatus?.(`loaded ✓ · last compute ${Math.round(t1 - t0)} ms`);
  } catch (e) {
    clearOutputs();
    updateRecommendation(null, inputs);
    showError(e?.message || "Could not compute results. Please check your inputs.");
    console.error(e);
  }
}

// Listeners
[elTypeMortgage, elTypePersonal].forEach((el) => el?.addEventListener("change", applyLoanTypeUI));
[elOutstanding, elMonths, elApr].forEach((el) => {
  el?.addEventListener("input", scheduleRecompute);
  el?.addEventListener("change", scheduleRecompute);
});
elOverpay?.addEventListener("input", scheduleRecompute);
elOverpay?.addEventListener("change", scheduleRecompute);
elExpectedReturn?.addEventListener("input", scheduleRecompute);
elExpectedReturn?.addEventListener("change", scheduleRecompute);

// Presets
$("#preset-mortgage")?.addEventListener("click", () => {
  elTypeMortgage.checked = true;
  elTypePersonal.checked = false;
  elOutstanding.value = "250000";
  elMonths.value = "300";
  elApr.value = "4.5";
  elOverpay.value = "200";
  applyLoanTypeUI();
});
$("#preset-personal")?.addEventListener("click", () => {
  elTypePersonal.checked = true;
  elTypeMortgage.checked = false;
  elOutstanding.value = "10000";
  elMonths.value = "60";
  elApr.value = "9.9";
  elOverpay.value = "50";
  applyLoanTypeUI();
});

// Boot
applyLoanTypeUI();
