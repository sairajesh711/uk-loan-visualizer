// UI glue (keeps engine API intact)
let engine = null;

const $ = (s) => document.querySelector(s);
const fmtGBP = (n) =>
  (Number.isFinite(n) ? n : 0).toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  });
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// DOM
const sectionOverpay = $("#overpayment-visualizer");
const sectionInvest = $("#investment-comparison");

const elOutstanding = $("#outstandingBalance");
const elCurrentPayment = $("#currentMonthlyPayment");
const elApr = $("#interestApr");
const elTerm = $("#remainingTermMonths");
const elOverpay = $("#overpayMonthly");
const elOverpayValue = $("#overpayValue");

const timelineNew = $("#timeline-new");
const outMonthsSaved = $("#result-monthsSaved");
const outInterestSaved = $("#result-interestSaved");

const outOverpayPot = $("#result-overpayPot");
const outInvestPot = $("#result-investPot");
const cardOverpay = $("#card-overpay");
const cardInvest = $("#card-invest");

const btnCalc = $("#calculate-btn");
const btnShowInvest = $("#show-investment-btn");
const btnBack = $("#back-to-overpay-btn");
const btnRecalc = $("#recalculate-btn");

const elExpectedReturn = $("#expectedReturn");
const elExpectedReturnValue = $("#expectedReturnValue");

const recommendationPanel = $("#recommendation-panel");
const recommendationTitle = $("#recommendation-title");
const recommendationText = $("#recommendation-text");

const errorBanner = $("#errorBanner");
const errorText = $("#errorText");

// Chart
let wealthChart = null;
if (window.Chart && window["chartjs-plugin-annotation"]) {
  window.Chart.register(window["chartjs-plugin-annotation"]);
}
const CHART_COLORS = {
  overpay: "rgb(6,182,212)", // cyan
  invest: "rgb(34,197,94)",  // green
  grid: "rgba(148,163,184,.3)",
  tick: "#cbd5e1",
};

//-------------------------------------
// Engine loader & init defaults
//-------------------------------------
async function loadEngine() {
  try {
    engine = await import("./engine.js");
    setInitialValues();
  } catch (e) {
    showError("Engine failed to load. Please build it and reload.");
    console.error(e);
  }
}
loadEngine();

function setInitialValues() {
  elOutstanding.value = "250000";
  elCurrentPayment.value = "1350";
  elApr.value = "4.25";
  elTerm.value = "300";
  elOverpay.value = "200";
  elOverpayValue.textContent = fmtGBP(200);
  elExpectedReturn.value = "5.0";
  elExpectedReturnValue.textContent = "5.0%";
}

//-------------------------------------
// Helpers (errors, animation, inputs)
//-------------------------------------
function showError(msg) {
  if (errorText) errorText.textContent = String(msg || "Invalid input.");
  errorBanner?.classList.remove("d-none");
}
function clearError() {
  if (errorText) errorText.textContent = "";
  errorBanner?.classList.add("d-none");
}

function animateGBP(el, to) {
  const from = parseFloat(el.textContent.replace(/[^0-9.-]+/g, "")) || 0;
  if (!Number.isFinite(to)) return;
  if (Math.abs(to - from) < 1) {
    el.textContent = fmtGBP(to);
    return;
  }
  const duration = 450;
  const start = performance.now();
  const step = (t) => {
    const p = Math.min((t - start) / duration, 1);
    el.textContent = fmtGBP(from + (to - from) * p);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Read form values safely (allow blanks while typing)
function readInputs() {
  const num = (el) => {
    const v = el.value.trim();
    if (v === "") return NaN;
    return Number(v);
  };
  return {
    outstandingBalance: num(elOutstanding),
    currentMonthlyPayment: num(elCurrentPayment),
    aprPercent: num(elApr),
    remainingTermMonths: num(elTerm),
    monthlyOverpayment: Number(elOverpay.value || 0),
    expectedAnnualReturnPercent: Number(elExpectedReturn.value || 0),
  };
}

function inputsAreComplete(i) {
  return (
    Number.isFinite(i.outstandingBalance) &&
    Number.isFinite(i.currentMonthlyPayment) &&
    Number.isFinite(i.aprPercent) &&
    Number.isFinite(i.remainingTermMonths)
  );
}

//-------------------------------------
// Act I — Overpayment quick calc
//-------------------------------------
function recomputeOverpayment() {
  if (!engine) return;
  clearError();

  const i = readInputs();
  if (!inputsAreComplete(i)) {
    // Clear KPIs if still typing
    outMonthsSaved.textContent = "—";
    outInterestSaved.textContent = "—";
    timelineNew.style.width = "100%";
    return;
  }

  try {
    // clamp gentle bounds
    const P = clamp(i.outstandingBalance, 1, 1e8);
    const R = clamp(i.currentMonthlyPayment, 1, 1e6);
    const N = clamp(Math.floor(i.remainingTermMonths), 1, 1200);
    const apr = clamp(i.aprPercent, 0, 100);
    const O = clamp(i.monthlyOverpayment, 0, 10000);

    const r_m = engine.monthlyRateFromAPR(apr);
    const baseline = engine.simulateLoan(P, r_m, R, N);
    const withOverpay = engine.simulateLoan(P, r_m, R + O, N);

    const monthsSaved = Math.max(0, baseline.months - withOverpay.months);
    const interestSaved = Math.max(
      0,
      baseline.totalInterest - withOverpay.totalInterest
    );

    outMonthsSaved.textContent = `${monthsSaved} months`;
    animateGBP(outInterestSaved, interestSaved);

    const pct = clamp((withOverpay.months / baseline.months) * 100, 0, 100);
    timelineNew.style.width = `${pct}%`;
  } catch (e) {
    showError(e.message);
  }
}

//-------------------------------------
// Act II — Apples-to-apples comparison
//-------------------------------------
function recomputeComparison() {
  if (!engine) return;
  clearError();

  const i = readInputs();
  if (!inputsAreComplete(i)) {
    showError("Please complete your loan details on the first page.");
    return;
  }

  try {
    const res = engine.calculateDualLedgerJourney(i);

    // Pots
    animateGBP(outOverpayPot, res.fair.atN.overpayPot);
    animateGBP(outInvestPot, res.fair.atN.investPot);

    // Winner highlight
    cardOverpay.classList.remove("is-winner");
    cardInvest.classList.remove("is-winner");
    const delta = res.fair.atN.overpayPot - res.fair.atN.investPot;
    if (delta > 500) {
      // Overpay wins
      recommendationPanel.classList.remove("invest");
      recommendationPanel.classList.add("overpay");
      recommendationTitle.textContent = "Recommendation";
      recommendationText.textContent =
        `Based on your inputs, overpaying is projected to end ` +
        `with ${fmtGBP(delta)} more wealth by your original loan end date.`;
      cardOverpay.classList.add("is-winner");
    } else if (delta < -500) {
      // Invest wins
      recommendationPanel.classList.remove("overpay");
      recommendationPanel.classList.add("invest");
      recommendationTitle.textContent = "Recommendation";
      recommendationText.textContent =
        `Based on your inputs, investing your extra money would result ` +
        `in ${fmtGBP(-delta)} more wealth than overpaying by the original end date.`;
      cardInvest.classList.add("is-winner");
    } else {
      recommendationPanel.classList.remove("overpay");
      recommendationPanel.classList.add("invest");
      recommendationTitle.textContent = "Recommendation";
      recommendationText.textContent =
        "It’s a close call — both strategies end up very similar at your original payoff date.";
    }

    // Chart data — net wealth over time
    const labels = res.fair.investPath.schedule.map((p) => p.month);
    const wealthInvest = res.fair.investPath.schedule.map((p) => p.wealth);
    const wealthOverpay = res.fair.overpayPath.schedule.map((p) => p.wealth);
    const M = res.withOverpay.months;
    const N = res.baseline.months;

    upsertWealthChart({ labels, wealthInvest, wealthOverpay, M, N });
  } catch (e) {
    showError(e.message);
    console.error(e);
  }
}

function upsertWealthChart({ labels, wealthInvest, wealthOverpay, M, N }) {
  const ctx = $("#wealthChart")?.getContext?.("2d");
  if (!ctx || !window.Chart) return;

  const ann = {
    annotations: {
      phase: {
        type: "box",
        xMin: M,
        xMax: N,
        backgroundColor: "rgba(34,197,94,0.06)",
        borderWidth: 0,
      },
      mline: {
        type: "line",
        xMin: M,
        xMax: M,
        borderColor: "rgba(34,197,94,.75)",
        borderWidth: 2,
        label: { enabled: true, content: `Loan cleared (month ${M})` },
      },
    },
  };

  const commonOptions = {
    responsive: true,
    animation: false,
    interaction: { mode: "index", intersect: false },
    scales: {
      x: {
        title: { display: true, text: "Months from now" },
        ticks: { color: CHART_COLORS.tick },
        grid: { color: CHART_COLORS.grid },
      },
      y: {
        title: { display: true, text: "Net Wealth (£)" },
        ticks: {
          color: CHART_COLORS.tick,
          callback: (v) => fmtGBP(v),
        },
        grid: { color: CHART_COLORS.grid },
        beginAtZero: true,
      },
    },
    plugins: {
      legend: { labels: { color: CHART_COLORS.tick } },
      tooltip: {
        callbacks: {
          label: (c) => `${c.dataset.label}: ${fmtGBP(c.parsed.y)}`,
        },
      },
      annotation: ann,
    },
  };

  if (!wealthChart) {
    wealthChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Net Wealth — Invest Path",
            data: wealthInvest,
            borderColor: CHART_COLORS.invest,
            backgroundColor: "rgba(34,197,94,.12)",
            borderWidth: 3,
            pointRadius: 0,
            tension: 0.18,
            fill: false,
          },
          {
            label: "Net Wealth — Overpay Path",
            data: wealthOverpay,
            borderColor: CHART_COLORS.overpay,
            backgroundColor: "rgba(6,182,212,.12)",
            borderWidth: 3,
            pointRadius: 0,
            tension: 0.18,
            fill: false,
          },
        ],
      },
      options: commonOptions,
    });
  } else {
    wealthChart.data.labels = labels;
    wealthChart.data.datasets[0].data = wealthInvest;
    wealthChart.data.datasets[1].data = wealthOverpay;
    wealthChart.options = { ...wealthChart.options, ...commonOptions };
    wealthChart.update();
  }
}

//-------------------------------------
// Events (ensure everything works)
//-------------------------------------
elOverpay.addEventListener("input", () => {
  elOverpayValue.textContent = fmtGBP(Number(elOverpay.value || 0));
  // responsive feel on Act I
  recomputeOverpayment();
});

["input"].forEach((ev) => {
  [elOutstanding, elCurrentPayment, elApr, elTerm].forEach((el) =>
    el.addEventListener(ev, () => {
      // Only recompute if numbers are complete (avoids backspace glitch)
      recomputeOverpayment();
    })
  );
});

btnCalc.addEventListener("click", recomputeOverpayment);

btnShowInvest.addEventListener("click", () => {
  sectionOverpay.classList.add("d-none");
  sectionInvest.classList.remove("d-none");
  recomputeComparison();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

btnBack.addEventListener("click", () => {
  sectionInvest.classList.add("d-none");
  sectionOverpay.classList.remove("d-none");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

elExpectedReturn.addEventListener("input", () => {
  elExpectedReturnValue.textContent = `${Number(elExpectedReturn.value || 0).toFixed(1)}%`;
});
btnRecalc.addEventListener("click", recomputeComparison);
