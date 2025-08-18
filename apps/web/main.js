// UK Loan Visualizer - Implementing exact data contract specifications
let engine = null;

// DOM helpers
const $ = (sel) => document.querySelector(sel);
const fmtGBP = (n) =>
  (Number.isFinite(n) ? n : 0).toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2
  });
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const addMonths = (d, m) => {
  const x = new Date(d.getTime());
  const day = x.getDate();
  x.setMonth(x.getMonth() + m);
  if (x.getDate() < day) x.setDate(0);
  return x;
};
const formatMMMYYYY = (d) => d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });

// Elements
const elTypeMortgage = $("#loanType-mortgage");
const elTypePersonal = $("#loanType-personal");
const elOutstanding = $("#outstandingBalance");
const elMonths = $("#remainingTermMonths");
const elApr = $("#interestApr");
const elOverpay = $("#overpayMonthly");
const elOverpayValue = $("#overpayValue"); // <-- match HTML id
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
  personal: { outstanding: "10000", months: "60", apr: "9.9", sliderMax: 1000, sliderStep: 25 }
};
const DEFAULT_RECOMMENDED_RATE = 4.0;

function applyRecommendedRate() {
  if (elRecommendedRate) elRecommendedRate.textContent = `${DEFAULT_RECOMMENDED_RATE.toFixed(1)}%`;
  if (!elExpectedReturn?.dataset.setOnce) {
    elExpectedReturn.value = String(DEFAULT_RECOMMENDED_RATE);
    if (elExpectedReturnValue) elExpectedReturnValue.textContent = `${DEFAULT_RECOMMENDED_RATE.toFixed(1)}%`;
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
    const bsFont = s.getPropertyValue('--bs-body-font-family')?.trim();
    const bsColor = s.getPropertyValue('--bs-body-color')?.trim();
    if (bsFont) window.Chart.defaults.font.family = bsFont;
    if (bsColor) window.Chart.defaults.color = bsColor;
  }
} catch {}

// Chart references
let balanceChart = null;
let interestChart = null;
let oppLineChart = null;
let oppBarChart = null;

// Load engine
async function loadEngine() {
  try {
    engine = await import("../../packages/engine/dist/index.js");
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

  // Update DOM to match validated values
  if (Number(elOutstanding.value) !== outstanding) elOutstanding.value = String(outstanding);
  if (Number(elMonths.value) !== months) elMonths.value = String(months);
  if (Number(elApr.value) !== apr) elApr.value = String(apr);
  if (Number(elOverpay.value) !== overpay) elOverpay.value = String(overpay);

  return {
    outstandingBalance: outstanding,
    remainingTermMonths: months,
    aprPercent: apr,
    monthlyOverpayment: overpay,
    expectedAnnualReturnPercent: expectedReturn
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
}

// Commit 5: Payoff visualization helper
function buildPayoffSeries(res) {
  const maxMonths = Math.max(res.baseline.months, res.withOverpay.months);
  const labels = Array.from({ length: maxMonths + 1 }, (_, i) => i);

  // Prefer explicit opening balance; fall back to first seen
  const initialBalance =
    res.baseline.schedule[0]?.openingBalance ??
    res.withOverpay.schedule[0]?.openingBalance ??
    0;

  // Build balance series
  const baselineBalances = [initialBalance, ...res.baseline.schedule.map((e) => e.closingBalance)];
  const overpayBalances = [initialBalance, ...res.withOverpay.schedule.map((e) => e.closingBalance)];

  // Pad shorter series with nulls
  while (baselineBalances.length < labels.length) baselineBalances.push(null);
  while (overpayBalances.length < labels.length) overpayBalances.push(null);

  return {
    labels,
    baselineBalances,
    overpayBalances,
    baselineMonths: res.baseline.months,
    overpayMonths: res.withOverpay.months,
    baselineSchedule: res.baseline.schedule,
    overpaySchedule: res.withOverpay.schedule
  };
}

// Commit 7: Investment comparison helpers
function monthlyRateFromAnnual(annualPercent) {
  const annual = clamp(Number(annualPercent) || 0, 0, 100) / 100;
  return Math.pow(1 + annual, 1 / 12) - 1;
}

function buildOpportunitySeries(res, inputs, sensDelta = 2) {
  const n = res.baseline.months;
  const monthlyOverpayment = inputs.monthlyOverpayment;
  const expectedReturn = inputs.expectedAnnualReturnPercent;

  // Main investment scenario
  const r = monthlyRateFromAnnual(expectedReturn);
  const invested = [];
  let pot = 0;
  for (let t = 0; t < n; t++) {
    pot = pot * (1 + r) + monthlyOverpayment;
    invested.push(pot);
  }

  // Sensitivity bands (±sensDelta%)
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

  // Cumulative interest saved series
  const cumSaved = [];
  let cumulative = 0;
  for (let t = 0; t < n; t++) {
    const baselineInterest = res.baseline.schedule[t]?.interest || 0;
    const overpayInterest = res.withOverpay.schedule[t]?.interest || 0; // 0 after overpay finishes
    cumulative += baselineInterest - overpayInterest;
    cumSaved.push(cumulative);
  }

  // Find crossover month (first month where invested >= cumSaved)
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
    interestSavedFinal: cumSaved[n - 1] || 0
  };
}

// Chart update functions
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
      label: {
        enabled: true,
        content: `Original: ${formatMMMYYYY(addMonths(new Date(), series.baselineMonths))}`
      }
    },
    overpayPayoff: {
      type: "line",
      xMin: series.overpayMonths,
      xMax: series.overpayMonths,
      borderColor: "rgba(34, 197, 94, 0.7)",
      borderWidth: 2,
      label: {
        enabled: true,
        content: `Overpay: ${formatMMMYYYY(addMonths(new Date(), series.overpayMonths))}`
      }
    }
  };

  if (!balanceChart) {
    balanceChart = new window.Chart(ctx, {
      type: "line",
      data: {
        labels: series.labels,
        datasets: [
          {
            label: "Baseline balance",
            data: series.baselineBalances,
            tension: 0.15,
            pointRadius: 0,
            borderWidth: 2,
            borderColor: "rgb(239, 68, 68)",
            backgroundColor: "rgba(239, 68, 68, 0.1)"
          },
          {
            label: "With overpayment",
            data: series.overpayBalances,
            tension: 0.15,
            pointRadius: 0,
            borderWidth: 2,
            borderColor: "rgb(34, 197, 94)",
            backgroundColor: "rgba(34, 197, 94, 0.1)"
          }
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
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtGBP(ctx.parsed.y)}` } },
          legend: { display: true },
          annotation: { annotations }
        }
      }
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

  // Create monthly interest comparison for first 24 months
  const months = Math.min(24, series.baselineMonths);
  const labels = Array.from({ length: months }, (_, i) => `Month ${i + 1}`);
  
  // Extract monthly interest payments
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
          {
            label: "Interest (baseline)",
            data: baselineInterest,
            backgroundColor: "rgba(239, 68, 68, 0.6)",
            borderColor: "rgb(239, 68, 68)",
            borderWidth: 1
          },
          {
            label: "Interest (with overpay)",
            data: overpayInterest,
            backgroundColor: "rgba(34, 197, 94, 0.6)",
            borderColor: "rgb(34, 197, 94)",
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        animation: false,
        scales: {
          x: { title: { display: true, text: "First 24 months" } },
          y: {
            title: { display: true, text: "Monthly Interest (£)" },
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
    series.crossoverIndex >= 0
      ? {
          annotations: {
            crossover: {
              type: "line",
              xMin: series.crossoverIndex + 1,
              xMax: series.crossoverIndex + 1,
              borderColor: "rgba(234, 179, 8, 0.7)",
              borderWidth: 2,
              label: {
                enabled: true,
                position: "start",
                content: `Crossover: month ${series.crossoverIndex + 1}`
              }
            }
          }
        }
      : { annotations: {} };

  if (!oppLineChart) {
    oppLineChart = new window.Chart(ctx, {
      type: "line",
      data: {
        labels: series.labels,
        datasets: [
          {
            label: "Invested (low)",
            data: series.investedLow,
            borderWidth: 0,
            fill: "+1",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
            borderColor: "rgba(59, 130, 246, 0.3)",
            pointRadius: 0,
            tension: 0.15
          },
          {
            label: "Invested (high)",
            data: series.investedHigh,
            borderWidth: 0,
            fill: false,
            backgroundColor: "rgba(59, 130, 246, 0.1)",
            borderColor: "rgba(59, 130, 246, 0.3)",
            pointRadius: 0,
            tension: 0.15
          },
          {
            label: "Invested pot (DCA)",
            data: series.invested,
            tension: 0.15,
            pointRadius: 0,
            borderWidth: 2,
            borderColor: "rgb(59, 130, 246)",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
            fill: false
          },
          {
            label: "Cumulative interest saved (overpay)",
            data: series.cumSaved,
            tension: 0.15,
            pointRadius: 0,
            borderWidth: 2,
            borderColor: "rgb(34, 197, 94)",
            backgroundColor: "rgba(34, 197, 94, 0.1)",
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        animation: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { title: { display: true, text: "Months (original term)" } },
          y: {
            title: { display: true, text: "£" },
            ticks: { callback: (v) => fmtGBP(v) },
            beginAtZero: true
          }
        },
        plugins: {
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtGBP(ctx.parsed.y)}` } },
          legend: {
            display: true,
            labels: {
              // hide low/high guide labels from legend
              filter: (legendItem) => !legendItem.text.includes("(low)") && !legendItem.text.includes("(high)")
            }
          },
          annotation
        }
      }
    });
  } else {
    oppLineChart.data.labels = series.labels;
    oppLineChart.data.datasets[0].data = series.investedLow;
    oppLineChart.data.datasets[1].data = series.investedHigh;
    oppLineChart.data.datasets[2].data = series.invested;
    oppLineChart.data.datasets[3].data = series.cumSaved;
    oppLineChart.options.plugins.annotation = annotation;
    oppLineChart.update();
  }
}

function upsertOppBarChart(series) {
  const ctx = $("#oppBarChart")?.getContext?.("2d");
  if (!ctx || !window.Chart) return;

  if (!oppBarChart) {
    oppBarChart = new window.Chart(ctx, {
      type: "bar",
      data: {
        labels: ["By the original payoff date"],
        datasets: [
          // sensitivity "ghost" bars first so they render behind
          {
            label: "FV low",
            data: [series.FVlow],
            backgroundColor: "rgba(59, 130, 246, 0.2)",
            borderColor: "rgba(59, 130, 246, 0.3)",
            borderWidth: 1
          },
          {
            label: "FV high",
            data: [series.FVhigh],
            backgroundColor: "rgba(59, 130, 246, 0.2)",
            borderColor: "rgba(59, 130, 246, 0.3)",
            borderWidth: 1
          },
          {
            label: "Interest Saved (Overpay)",
            data: [series.interestSavedFinal],
            backgroundColor: "rgba(34, 197, 94, 0.6)",
            borderColor: "rgb(34, 197, 94)",
            borderWidth: 1
          },
          {
            label: "FV if Invested (DCA)",
            data: [series.FV],
            backgroundColor: "rgba(59, 130, 246, 0.6)",
            borderColor: "rgb(59, 130, 246)",
            borderWidth: 1
          }
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
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const label = ctx.dataset.label;
                const value = fmtGBP(ctx.parsed.y);
                if (label.includes("FV low") || label.includes("FV high")) {
                  return `${label}: ${value} (sensitivity band)`;
                }
                return `${label}: ${value}`;
              }
            }
          },
          legend: {
            display: true,
            labels: {
              // hide low/high guides from legend
              filter: (legendItem) => !legendItem.text.includes("FV low") && !legendItem.text.includes("FV high")
            }
          }
        }
      }
    });
  } else {
    oppBarChart.data.datasets[0].data = [series.FVlow];
    oppBarChart.data.datasets[1].data = [series.FVhigh];
    oppBarChart.data.datasets[2].data = [series.interestSavedFinal];
    oppBarChart.data.datasets[3].data = [series.FV];
    oppBarChart.update();
  }
}

// Main computation function
function recompute() {
  clearError();
  if (elOverpayValue) elOverpayValue.textContent = fmtGBP(Number(elOverpay.value || 0));
  if (elExpectedReturnValue) elExpectedReturnValue.textContent = `${Number(elExpectedReturn.value || 0).toFixed(1)}%`;
  if (!engine) return;

  const inputs = readInputs();
  if (!Number.isFinite(inputs.outstandingBalance) || inputs.outstandingBalance === 0) {
    clearOutputs();
    return;
  }

  try {
    const t0 = performance.now();
    const res = engine.calculateRepaymentJourney(inputs);

    // Update basic results using data contract
    const payoffDate = formatMMMYYYY(addMonths(new Date(), res.withOverpay.months));
    outPayoffDate.textContent = payoffDate;
    outInterestSaved.textContent = fmtGBP(res.interestSaved);
    outTotalInterest.textContent = fmtGBP(res.withOverpay.totalInterest);
    outMonthsSaved.textContent = String(res.monthsSaved);

    // Investment analysis results (if available)
    if (res.invest) {
      outFvInvest.textContent = fmtGBP(res.invest.fvInvest);
      outDeltaSimple.textContent = fmtGBP(res.invest.deltaVsOverpaySimple);
    }

    // Update charts
    const payoffSeries = buildPayoffSeries(res);
    upsertBalanceChart(payoffSeries);
    upsertInterestChart(payoffSeries);

    const oppSeries = buildOpportunitySeries(res, inputs);
    upsertOppLineChart(oppSeries);
    upsertOppBarChart(oppSeries);

    const t1 = performance.now();
    setStatus?.(`loaded ✓ · last compute ${Math.round(t1 - t0)} ms`);
  } catch (e) {
    clearOutputs();
    showError(e?.message || "Could not compute results. Please check your inputs.");
    console.error(e);
  }
}

// Event listeners
[elTypeMortgage, elTypePersonal].forEach((el) => el?.addEventListener("change", applyLoanTypeUI));
[elOutstanding, elMonths, elApr].forEach((el) => {
  el?.addEventListener("input", scheduleRecompute);
  el?.addEventListener("change", scheduleRecompute);
});
elOverpay?.addEventListener("input", scheduleRecompute);
elOverpay?.addEventListener("change", scheduleRecompute);
elExpectedReturn?.addEventListener("input", scheduleRecompute);
elExpectedReturn?.addEventListener("change", scheduleRecompute);

// Preset buttons
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
