// engine.js — Dual-Ledger apples-to-apples simulator (ES module)
// VERSION: CORRECTED AND VERIFIED

const EPS = 1e-9;

/**
 * Converts an annual percentage rate (e.g., 5 for 5%) to a monthly effective decimal rate.
 * @param {number} aprPercent - The annual percentage rate.
 * @returns {number} The monthly decimal rate.
 */
export function monthlyRateFromAPR(aprPercent) {
  const a = Math.max(0, Number(aprPercent) || 0) / 100;
  // (1 + annual_rate)^(1/12) - 1
  return Math.pow(1 + a, 1 / 12) - 1;
}

/**
 * Simulates a simple loan amortization schedule.
 * @param {number} balanceStart - The initial loan balance.
 * @param {number} r_m - The monthly decimal rate.
 * @param {number} payment - The fixed monthly payment.
 * @param {number} maxMonths - A cap for the simulation length.
 * @returns {{months: number, totalInterest: number, schedule: Array<object>}}
 */
export function simulateLoan(balanceStart, r_m, payment, maxMonths) {
  const schedule = [];
  let balance = Math.max(0, balanceStart);
  let totalInterest = 0;
  let months = 0;

  // Safety cap to prevent infinite loops with unusual inputs
  const CAP = maxMonths + 120; 

  while (balance > EPS && months < CAP) {
    const interest = balance * r_m;
    // Ensure payment is enough to cover interest to avoid infinite loan
    if (payment < interest) {
        throw new Error("Payment is less than interest. Loan balance will grow.");
    }
    const principal = Math.min(payment - interest, balance);
    balance -= principal;

    schedule.push({
      month: months + 1,
      balance,
      interest,
      payment,
    });

    totalInterest += interest;
    months += 1;
  }

  return { months, totalInterest, schedule };
}

/**
 * Simulates the two "apples-to-apples" financial paths.
 * @returns The detailed schedules and final outcomes for both paths.
 */
function simulateApplesPaths({ P, N, rLoan_m, R, O, M, rAnnual }) {
  const rInv_m = monthlyRateFromAPR(rAnnual);

  let balInvest = P;
  let balOverpay = P;
  let potInvest = 0;
  let potOverpay = 0;

  const investPathSchedule = [];
  const overpayPathSchedule = [];

  for (let t = 1; t <= N; t++) {
    // --- Path 1: INVEST ---
    const intI = balInvest * rLoan_m;
    const prinI = Math.min(R - intI, balInvest);
    balInvest -= prinI;

    const growthI = potInvest * rInv_m;
    potInvest += growthI + O;
    const wealthInvest = potInvest - balInvest;

    investPathSchedule.push({
      month: t, balance: balInvest, interest: intI, payment: R,
      investPot: potInvest, investContrib: O, investGrowth: growthI, wealth: wealthInvest
    });

    // --- Path 2: OVERPAY ---
    const isPayingDebt = t <= M;
    let intO = 0, payO = 0, contribO = 0;

    if (isPayingDebt) {
      payO = R + O;
      intO = balOverpay * rLoan_m;
      const prinO = Math.min(payO - intO, balOverpay);
      balOverpay -= prinO;
    } else {
      balOverpay = 0;
      contribO = R + O;
    }
    
    const growthO = potOverpay * rInv_m;
    potOverpay += growthO + contribO;
    const wealthOverpay = potOverpay - balOverpay;

    overpayPathSchedule.push({
      month: t, balance: balOverpay, interest: intO, payment: payO,
      investPot: potOverpay, investContrib: contribO, investGrowth: growthO, wealth: wealthOverpay
    });
  }

  return {
    investPath: {
      months: N, schedule: investPathSchedule,
      totalInterest: investPathSchedule.reduce((s, e) => s + e.interest, 0),
      finalPot: potInvest
    },
    overpayPath: {
      months: N, schedule: overpayPathSchedule,
      totalInterest: overpayPathSchedule.reduce((s, e) => s + e.interest, 0),
      finalPot: potOverpay
    },
    atN: {
      investPot: potInvest,
      overpayPot: potOverpay,
      delta: potOverpay - potInvest
    }
  };
}

/**
 * Uses a bisection search to find the investment return rate where both paths yield the same final wealth.
 * @returns {number | null} The break-even annual return percentage, or null if not found.
 */
function computeBreakEvenReturn({ P, N, rLoan_m, R, O, M }) {
  const deltaAt = (rAnnual) => {
    const result = simulateApplesPaths({ P, N, rLoan_m, R, O, M, rAnnual });
    return result.atN.delta;
  };

  let lo = 0.0;
  let hi = 100.0;
  let fLo = deltaAt(lo);

  if (Math.abs(fLo) < 1) return 0;

  let fHi = deltaAt(hi);

  if (Math.sign(fLo) === Math.sign(fHi)) {
    return null;
  }

  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const fMid = deltaAt(mid);
    if (Math.abs(fMid) < 1) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid; fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Main exported function that orchestrates all calculations.
 * @param {object} inputs - The user's loan and investment parameters.
 * @returns {object} The complete, structured output for the UI.
 */
export function calculateDualLedgerJourney(inputs) {
  const {
    outstandingBalance, remainingTermMonths, aprPercent,
    currentMonthlyPayment, monthlyOverpayment, expectedAnnualReturnPercent
  } = inputs;

  if (!Number.isFinite(outstandingBalance) || outstandingBalance <= 0) throw new Error("Outstanding balance must be > 0.");
  if (!Number.isInteger(remainingTermMonths) || remainingTermMonths < 1) throw new Error("Remaining term must be ≥ 1.");
  if (!Number.isFinite(aprPercent) || aprPercent < 0) throw new Error("APR must be ≥ 0.");
  if (!Number.isFinite(currentMonthlyPayment) || currentMonthlyPayment <= 0) throw new Error("Current monthly payment must be > 0.");
  if (!Number.isFinite(monthlyOverpayment) || monthlyOverpayment < 0) throw new Error("Monthly overpayment must be ≥ 0.");

  const P = outstandingBalance;
  const N = remainingTermMonths;
  const O = monthlyOverpayment;
  const R = currentMonthlyPayment;
  const rLoan_m = monthlyRateFromAPR(aprPercent);

  const firstMonthInterest = P * rLoan_m;
  if (R < firstMonthInterest) {
    throw new Error("Current payment is less than the first month's interest. The loan balance will increase.");
  }

  const baseline = simulateLoan(P, rLoan_m, R, N);
  const withOverpay = simulateLoan(P, rLoan_m, R + O, N);
  const M = withOverpay.months;

  // CRITICAL FIX: Compare the calculated baseline months with the new overpayment months.
  const monthsSaved = Math.max(0, baseline.months - withOverpay.months);
  const interestSaved = Math.max(0, baseline.totalInterest - withOverpay.totalInterest);

  // Use the baseline's calculated term as the fair comparison horizon
  const comparisonTerm = baseline.months;
  const fairPaths = simulateApplesPaths({
    P, N: comparisonTerm, rLoan_m, R, O, M, rAnnual: expectedAnnualReturnPercent
  });

  const breakEvenAnnualReturnPercent = computeBreakEvenReturn({ P, N: comparisonTerm, rLoan_m, R, O, M });
  
  const deltaWealthByMonth = fairPaths.overpayPath.schedule.map((p, i) => p.wealth - fairPaths.investPath.schedule[i].wealth);
  let crossoverMonth = null;
  for (let i = 0; i < deltaWealthByMonth.length; i++) {
    if (deltaWealthByMonth[i] >= 0) { crossoverMonth = i + 1; break; }
  }

  return {
    baseline,
    withOverpay,
    interestSaved,
    monthsSaved,
    requiredMonthlyPayment: R,
    fair: {
      requiredMonthlyPayment: R,
      investPath: fairPaths.investPath,
      overpayPath: fairPaths.overpayPath,
      deltaWealthByMonth,
      crossoverMonth,
      breakEvenAnnualReturnPercent,
      atN: fairPaths.atN
    }
  };
}
