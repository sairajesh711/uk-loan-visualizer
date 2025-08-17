
import { calculateRepaymentJourney } from "../../packages/engine/dist/index.js";

// ---------- DOM helpers ----------
const $ = (sel) => document.querySelector(sel);
const fmtGBP = (n) =>
  (Number.isFinite(n) ? n : 0).toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 });
const clamp = (val, min, max) => Math.min(Math.max(val, min), max);
const addMonths = (date, m) => {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + m);
  // handle month-end rollover
  if (d.getDate() < day) d.setDate(0);
  return d;
};
const formatMMMYYYY = (d) =>
  d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });

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

// ---------- State & defaults ----------
const placeholders = {
  mortgage: {
    outstanding: "250000",
    months: "300",
    apr: "4.25",
    sliderMax: 5000,
    sliderStep: 50
  },
  personal: {
    outstanding: "10000",
    months: "60",
    apr: "9.9",
    sliderMax: 1000,
    sliderStep: 25
  }
};

// ---------- UI reactions ----------
function applyLoanTypeUI() {
  const type = elTypeMortgage.checked ? "mortgage" : "personal";
  const p = placeholders[type];

  // Update placeholders to set the tone for inputs
  elOutstanding.placeholder = p.outstanding;
  elMonths.placeholder = p.months;
  elApr.placeholder = p.apr;

  // Slider affordances
  elOverpay.max = String(p.sliderMax);
  elOverpay.step = String(p.sliderStep);

  // If current slider exceeds new max (e.g., switched to personal), clamp it
  elOverpay.value = String(Math.min(Number(elOverpay.value || 0), p.sliderMax));

  // Re-render the displayed slider value
  elOverpayValue.textContent = fmtGBP(Number(elOverpay.value || 0));

  // Trigger a recompute with the current inputs
  recompute();
}

function readInputs() {
  // Enforce non-negatives and sensible minimums
  const outstanding = clamp(Number(elOutstanding.value || elOutstanding.placeholder || 0), 0, Number.MAX_SAFE_INTEGER);
  const months = Math.max(1, Math.floor(Number(elMonths.value || elMonths.placeholder || 1)));
  const apr = clamp(Number(elApr.value || elApr.placeholder || 0), 0, 1000);
  const overpay = clamp(Number(elOverpay.value || 0), 0, Number(elOverpay.max));

  // Write back clamped values to the DOM (so it's obvious to the user)
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
  // micro-debounce to collapse bursts of input events
  queueMicrotask(() => {
    recomputeScheduled = false;
    recompute();
  });
}

function recompute() {
  // Update slider label immediately
  elOverpayValue.textContent = fmtGBP(Number(elOverpay.value || 0));

  let inputs = readInputs();

  // Guard: If outstanding is 0, clear outputs
  if (!Number.isFinite(inputs.outstandingBalance) || inputs.outstandingBalance === 0) {
    outPayoffDate.textContent = "—";
    outInterestSaved.textContent = "—";
    outTotalInterest.textContent = "—";
    outMonthsSaved.textContent = "—";
    return;
  }

  try {
    const res = calculateRepaymentJourney(inputs);
    const payoffDate = formatMMMYYYY(addMonths(new Date(), res.withOverpay.months));

    outPayoffDate.textContent = payoffDate;
    outInterestSaved.textContent = fmtGBP(res.interestSaved);
    outTotalInterest.textContent = fmtGBP(res.withOverpay.totalInterest);
    outMonthsSaved.textContent = String(res.monthsSaved);
  } catch (e) {
    // If validation fails, reset outputs; in a later commit we can show inline errors
    outPayoffDate.textContent = "—";
    outInterestSaved.textContent = "—";
    outTotalInterest.textContent = "—";
    outMonthsSaved.textContent = "—";
    // console.error(e);
  }
}

// ---------- Events ----------
[elTypeMortgage, elTypePersonal].forEach((el) =>
  el.addEventListener("change", applyLoanTypeUI)
);

[elOutstanding, elMonths, elApr].forEach((el) => {
  el.addEventListener("input", scheduleRecompute);
  el.addEventListener("change", scheduleRecompute);
});

elOverpay.addEventListener("input", scheduleRecompute);
elOverpay.addEventListener("change", scheduleRecompute);

// ---------- Boot ----------
applyLoanTypeUI(); // sets placeholders & computes once
