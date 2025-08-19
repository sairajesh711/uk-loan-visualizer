// packages/engine/src/index.ts

import type { Inputs, DualLedgerOutput, LedgerPoint } from './types';

// ---------- helpers ----------
/**
 * Converts an annual percentage rate to a monthly effective rate.
 */
const annualToMonthlyRate = (annualPercent: number): number =>
  annualPercent <= 0 ? 0 : Math.pow(1 + annualPercent / 100, 1/12) - 1;

/**
 * Calculates the required monthly payment for a loan using the annuity formula.
 */
function requiredPayment(outstanding: number, months: number, aprPercent: number): number {
  const r = annualToMonthlyRate(aprPercent);
  if (months <= 0) return 0;
  if (r === 0) return outstanding / months;
  return (outstanding * r) / (1 - Math.pow(1 + r, -months));
}

class LoanLedger {
  private balance: number;
  private readonly r: number;

  constructor(initialBalance: number, aprPercent: number) {
    this.balance = Math.max(0, initialBalance);
    this.r = annualToMonthlyRate(aprPercent);
  }

  step(payment: number) {
    if (this.balance <= 0) {
      return { balance: 0, interest: 0, principal: 0 };
    }
    const interest = this.balance * this.r;
    const principal = Math.min(Math.max(0, payment - interest), this.balance);
    this.balance = Math.max(0, this.balance - principal);
    return { balance: this.balance, interest, principal };
  }
}

class InvestmentLedger {
  private pot = 0;
  private readonly r: number;
  constructor(annualPercent: number) { this.r = annualToMonthlyRate(annualPercent); }

  // End-of-month contribution: grow then add contribution
  step(contrib: number) {
    const growth = this.pot * this.r;
    this.pot = this.pot * (1 + this.r) + contrib;
    return { pot: this.pot, contrib, growth };
  }
}

// ---------- main simulation function ----------
export function calculateDualLedgerJourney(inputs: Inputs): DualLedgerOutput {
  const {
    outstandingBalance: P0,
    remainingTermMonths: N,
    aprPercent,
    monthlyOverpayment: O,
    expectedAnnualReturnPercent: rAnnual,
  } = inputs;

  if (!Number.isFinite(P0) || P0 < 0) throw new Error("Invalid outstanding balance");
  if (!Number.isInteger(N) || N < 1) throw new Error("Invalid remaining term");
  if (!Number.isFinite(aprPercent) || aprPercent < 0) throw new Error("Invalid APR");
  if (!Number.isFinite(O) || O < 0) throw new Error("Invalid overpayment");
  if (!Number.isFinite(rAnnual) || rAnnual < 0) throw new Error("Invalid expected return");

  const R = requiredPayment(P0, N, aprPercent);

  // --- 1. Baseline simulation (no overpayment) ---
  const baseLoan = new LoanLedger(P0, aprPercent);
  const baseSchedule: LedgerPoint[] = [];
  let baseInterest = 0;
  for (let month = 1; month <= N; month++) {
    const s = baseLoan.step(R);
    baseInterest += s.interest;
    baseSchedule.push({ month, balance: s.balance, interest: s.interest, payment: R, investPot: 0, investContrib: 0, investGrowth: 0, wealth: -s.balance });
  }

  // --- 2. Simple overpayment simulation (to find new payoff month M) ---
  const opLoan = new LoanLedger(P0, aprPercent);
  const overpaySimpleSchedule: LedgerPoint[] = [];
  let overpayInterest = 0;
  let M = 0;
  for (let month = 1; month <= N; month++) {
    const s = opLoan.step(R + O);
    overpayInterest += s.interest;
    overpaySimpleSchedule.push({ month, balance: s.balance, interest: s.interest, payment: R+O, investPot: 0, investContrib: 0, investGrowth: 0, wealth: -s.balance });
    if (s.balance <= 0 && M === 0) M = month;
  }
  if (M === 0) M = N; // Handles case where overpayment doesn't clear loan early

  // --- 3. Apples-to-Apples fair comparison simulation ---
  const investDebt = new LoanLedger(P0, aprPercent);
  const investPot  = new InvestmentLedger(rAnnual);
  const investPath: LedgerPoint[] = [];
  let investInt = 0;

  const overpayDebt = new LoanLedger(P0, aprPercent);
  const overpayPot  = new InvestmentLedger(rAnnual);
  const overpayPath: LedgerPoint[] = [];
  let overpayIntFair = 0;

  for (let t = 1; t <= N; t++) {
    // Path A (Invest): Pay standard loan, invest the overpayment amount
    const sA = investDebt.step(R);
    investInt += sA.interest;
    const invA = investPot.step(O);
    investPath.push({ month: t, balance: sA.balance, interest: sA.interest, payment: R, investPot: invA.pot, investContrib: O, investGrowth: invA.growth, wealth: invA.pot - sA.balance });

    // Path B (Overpay): Pay R+O until debt is clear, then "snowball" R+O into investments
    const isPayingDebt = t <= M;
    const paymentB = isPayingDebt ? (R + O) : 0;
    const contributionB = isPayingDebt ? 0 : (R + O);
    const sB = overpayDebt.step(paymentB);
    overpayIntFair += sB.interest;
    const invB = overpayPot.step(contributionB);
    overpayPath.push({ month: t, balance: sB.balance, interest: sB.interest, payment: paymentB, investPot: invB.pot, investContrib: contributionB, investGrowth: invB.growth, wealth: invB.pot - sB.balance });
  }

  // --- 4. Break-even return calculation ---
  function futureValueStream(contrib: number, months: number, rMonthly: number): number {
    if (months <= 0 || contrib <= 0) return 0;
    if (rMonthly === 0) return contrib * months;
    return contrib * ((Math.pow(1 + rMonthly, months) - 1) / rMonthly);
  }

  function finalPotsAtAnnual(rAnnualPercent: number) {
    const m = annualToMonthlyRate(rAnnualPercent);
    const potA = futureValueStream(O, N, m);
    const potB = futureValueStream(R + O, N - M, m);
    return { potA, potB };
  }

  function breakEvenAnnualReturn(): number | null {
    const z = finalPotsAtAnnual(0);
    if (Math.abs(z.potB - z.potA) < 1e-6) return 0;
    let lo = 0, hi = 50; // Increased range for high-interest loans
    const fLo = z.potB - z.potA;
    const fHi = finalPotsAtAnnual(hi).potB - finalPotsAtAnnual(hi).potA;
    if (fLo * fHi > 0) return null; // No break-even point in this range
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      const fm = finalPotsAtAnnual(mid).potB - finalPotsAtAnnual(mid).potA;
      if (Math.abs(fm) < 1e-6) return mid;
      (fLo * fm <= 0) ? hi = mid : lo = mid;
    }
    return (lo + hi) / 2;
  }

  // --- 5. Assemble final output ---
  return {
    baseline: {
      months: N,
      totalInterest: baseInterest,
      schedule: baseSchedule,
    },
    withOverpay: {
      months: M,
      totalInterest: overpayInterest,
      schedule: overpaySimpleSchedule.slice(0, M),
    },
    interestSaved: baseInterest - overpayInterest,
    monthsSaved: N - M,
    requiredMonthlyPayment: R,
    fair: {
      investPath: {
        months: N, schedule: investPath, totalInterest: investInt,
        finalPot: investPath[N - 1].investPot, finalWealth: investPath[N - 1].wealth,
      },
      overpayPath: {
        months: N, schedule: overpayPath, totalInterest: overpayIntFair,
        finalPot: overpayPath[N - 1].investPot, finalWealth: overpayPath[N - 1].wealth,
      },
      breakEvenAnnualReturnPercent: breakEvenAnnualReturn(),
      atN: {
        investPot: investPath[N - 1].investPot,
        overpayPot: overpayPath[N - 1].investPot,
        // CRITICAL FIX: Ensure delta correctly compares the two different pots.
        delta: overpayPath[N - 1].investPot - investPath[N - 1].investPot,
      },
    },
  };
}
