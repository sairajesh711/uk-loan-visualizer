// Commit 6: opportunity cost (expected return slider + invest vs overpay)
// dynamic import status + existing helpers preserved
let engine = null;
const $ = (sel) => document.querySelector(sel);
const fmtGBP = (n) => (Number.isFinite(n) ? n : 0).toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 });
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const addMonths = (d, m) => { const x = new Date(d.getTime()); const day = x.getDate(); x.setMonth(x.getMonth() + m); if (x.getDate() < day) x.setDate(0); return x; };
const formatMMMYYYY = (d) => d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });

// Elements
const elTypeMortgage = $("#loanType-mortgage");
const elTypePersonal = $("#loanType-personal");
const elOutstanding = $("#outstandingBalance");
const elMonths = $("#remainingTermMonths");
const elApr = $("#interestApr");
const elOverpay = $("#overpayMonthly");
const elOverpayValue = document.querySelector(".range .value");

// NEW: expected return controls
const elExpectedReturn = $("#expectedReturn");
const elExpectedReturnValue = $("#expectedReturnValue");
const elRecommendedRate = $("#recommendedRate");

const outPayoffDate = $("#result-payoffDate");
const outInterestSaved = $("#result-interestSaved");
const outTotalInterest = $("#result-totalInterest");
const outMonthsSaved = $("#result-monthsSaved");

// NEW results
const outFvInvest = $("#result-fvInvest");
const outDeltaSimple = $("#result-deltaSimple");
const outBreakEven = $("#result-breakEven");

// Error/status
const elErrorBanner = $("#errorBanner");
const elErrorText = $("#errorText");
const statusText = $("#statusText");
function showError(msg) { if (elErrorText) elErrorText.textContent = String(msg || "Invalid input."); elErrorBanner?.classList.remove("hidden"); }
function clearError() { if (elErrorText) elErrorText.textContent = ""; elErrorBanner?.classList.add("hidden"); }
function setStatus(msg) { if (statusText) statusText.textContent = msg; }

// Placeholders
const placeholders = {
  mortgage: { outstanding: "250000", months: "300", apr: "4.25", sliderMax: 5000, sliderStep: 50 },
  personal: { outstanding: "10000", months: "60",  apr: "9.9",  sliderMax: 1000, sliderStep: 25 }
};

// Chart refs from Commit 5 (if present)
let balanceChart = window.balanceChart || null;
let interestChart = window.interestChart || null;

// Recommended rate placeholder
const DEFAULT_RECOMMENDED_RATE = 4.0; // %/yr (edit anytime)
function applyRecommendedRate() {
  if (elRecommendedRate) elRecommendedRate.textContent = `${DEFAULT_RECOMMENDED_RATE.toFixed(1)}%`;
  // Optionally set slider to it on first load if you want:
  if (!elExpectedReturn?.dataset.setOnce) {
    elExpectedReturn.value = String(DEFAULT_RECOMMENDED_RATE);
    elExpectedReturnValue.textContent = `${Number(elExpectedReturn.value).toFixed(1)}%`;
    elExpectedReturn.dataset.setOnce = "1";
  }
}

// Load engine
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

// UI logic
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
  applyRecommendedRate();
  recompute();
}

function readInputs() {
  const outstanding = clamp(Number(elOutstanding.value || elOutstanding.placeholder || 0), 0, Number.MAX_SAFE_INTEGER);
  const months = Math.max(1, Math.floor(Number(elMonths.value || elMonths.placeholder || 1)));
  const apr = clamp(Number(elApr.value || elApr.placeholder || 0), 0, 1000);
  const overpay = clamp(Number(elOverpay.value || 0), 0, Number(elOverpay.max));
  const expectedReturn = clamp(Number(elExpectedReturn.value || 0), 0, 100);

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
    fairCompare: true
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
  outFvInvest.textContent = "—";
  outDeltaSimple.textContent = "—";
  outBreakEven.textContent = "—";
  if (balanceChart) { balanceChart.data.labels = []; balanceChart.data.datasets.forEach(d => d.data = []); balanceChart.update(); }
  if (interestChart) { interestChart.data.labels = []; interestChart.data.datasets.forEach(d => d.data = []); interestChart.update(); }
}

function recompute() {
  clearError();
  elOverpayValue.textContent = fmtGBP(Number(elOverpay.value || 0));
  if (elExpectedReturnValue) elExpectedReturnValue.textContent = `${Number(elExpectedReturn.value || 0).toFixed(1)}%`;
  if (!engine) return;

  const inputs = readInputs();
  if (!Number.isFinite(inputs.outstandingBalance) || inputs.outstandingBalance === 0) { clearOutputs(); return; }

  try {
    const t0 = performance.now();
    const res = engine.calculateRepaymentJourney(inputs);

    // existing outputs
    const payoffDate = formatMMMYYYY(addMonths(new Date(), res.withOverpay.months));
    outPayoffDate.textContent = payoffDate;
    outInterestSaved.textContent = fmtGBP(res.interestSaved);
    outTotalInterest.textContent = fmtGBP(res.withOverpay.totalInterest);
    outMonthsSaved.textContent = String(res.monthsSaved);

    // NEW outputs
    outFvInvest.textContent = fmtGBP(res.invest.fvInvest);
    outDeltaSimple.textContent = fmtGBP(res.invest.deltaVsOverpaySimple);
    outBreakEven.textContent = `${res.invest.requiredAnnualReturnPercent.toFixed(2)}%`;

    // (Charts from Commit 5 continue to update via existing code if present)
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

// NEW: expected return slider events
elExpectedReturn?.addEventListener("input", scheduleRecompute);
elExpectedReturn?.addEventListener("change", scheduleRecompute);

// Boot
applyLoanTypeUI();
