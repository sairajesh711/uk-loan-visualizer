/**
 * Commit 2: Core loan engine (pure JS)
 * - Penny-precision math to avoid float drift
 * - Standard amortization; monthly overpayment applied on top of required payment
 * - O(n) in months
 */

// ---------- OOP helpers (small & focused) ----------
class Money {
  constructor(pence) {
    if (!Number.isFinite(pence)) throw new Error("Money: non-finite value");
    this.pence = Math.round(pence);
  }
  static fromPounds(amount) {
    if (typeof amount !== "number") amount = Number(amount);
    return new Money(Math.round(amount * 100));
  }
  static fromPence(p) { return new Money(p); }
  add(m) { return Money.fromPence(this.pence + m.pence); }
  sub(m) { return Money.fromPence(this.pence - m.pence); }
  min(m) { return Money.fromPence(Math.min(this.pence, m.pence)); }
  max(m) { return Money.fromPence(Math.max(this.pence, m.pence)); }
  isNegative() { return this.pence < 0; }
  isZero() { return this.pence === 0; }
  toNumber() { return this.pence / 100; } // pounds
  clampNonNegative() { return this.pence < 0 ? Money.fromPence(0) : this; }
}

class Loan {
  constructor({ principal, remainingMonths, aprPercent }) {
    if (!(principal instanceof Money)) throw new Error("Loan: principal must be Money");
    if (!Number.isInteger(remainingMonths) || remainingMonths < 1)
      throw new Error("Loan: remainingMonths must be >= 1");
    if (!Number.isFinite(aprPercent) || aprPercent < 0)
      throw new Error("Loan: aprPercent must be >= 0");
    this.principal = principal;
    this.remainingMonths = remainingMonths;
    this.aprPercent = aprPercent;
  }

  monthlyRate() {
    return this.aprPercent === 0 ? 0 : (this.aprPercent / 100) / 12;
  }

  requiredMonthlyPayment() {
    // Compute the payment that amortizes the *current* outstanding over remainingMonths.
    const P = this.principal.toNumber(); // pounds
    const n = this.remainingMonths;
    const r = this.monthlyRate();
    let paymentPounds;
    if (r === 0) {
      paymentPounds = P / n;
    } else {
      const denom = 1 - Math.pow(1 + r, -n);
      paymentPounds = (P * r) / denom;
    }
    // Round to nearest penny
    return Money.fromPounds(paymentPounds);
  }
}

class OverpaymentSimulator {
  constructor(loan) { this.loan = loan; }

  simulate(monthlyOverpayment) {
    if (!(monthlyOverpayment instanceof Money))
      throw new Error("monthlyOverpayment must be Money");
    if (monthlyOverpayment.isNegative()) throw new Error("monthlyOverpayment cannot be negative");

    const schedule = [];
    const r = this.loan.monthlyRate();
    const requiredPay = this.loan.requiredMonthlyPayment();

    let balance = this.loan.principal;
    let month = 0;
    let totalInterest = Money.fromPence(0);

    // Safety cap: avoid runaway loops if something is off
    const MAX_MONTHS = this.loan.remainingMonths + 6000;

    while (!balance.isZero() && month < MAX_MONTHS) {
      const opening = balance;

      // interest in pence = round(balance_pence * r)
      const interest = Money.fromPence(Math.round(opening.pence * r));

      // total payment this month
      const plannedPayment = requiredPay.add(monthlyOverpayment);

      // principal = payment - interest, at least 0
      let principalPay = plannedPayment.sub(interest);
      if (principalPay.isNegative()) principalPay = Money.fromPence(0);

      // Cap principal so we don't overpay past zero
      principalPay = principalPay.min(opening);

      const closing = opening.sub(principalPay);

      schedule.push({
        monthIndex: month,
        openingBalance: opening.toNumber(),
        interest: interest.toNumber(),
        principal: principalPay.toNumber(),
        overpayment: monthlyOverpayment.toNumber(),
        requiredPayment: requiredPay.toNumber(),
        closingBalance: closing.toNumber()
      });

      totalInterest = totalInterest.add(interest);
      balance = closing;
      month += 1;
    }

    return {
      schedule,
      months: schedule.length,
      totalInterest: totalInterest.toNumber()
    };
  }
}

// ---------- Public, pure entrypoint (what you'll import) ----------
/**
 * calculateRepaymentJourney
 * @param {object} input
 * @param {number} input.outstandingBalance - pounds, >= 0
 * @param {number} input.remainingTermMonths - integer, >= 1
 * @param {number} input.aprPercent - APR %, >= 0
 * @param {number} input.monthlyOverpayment - pounds, >= 0
 * @returns {{
 *   baseline: { months: number, totalInterest: number },
 *   withOverpay: { months: number, totalInterest: number },
 *   interestSaved: number,
 *   monthsSaved: number,
 *   schedule: Array<{ monthIndex:number, openingBalance:number, interest:number, principal:number, overpayment:number, requiredPayment:number, closingBalance:number }>
 * }}
 */
export function calculateRepaymentJourney(input) {
  // ---- Validation (reject negatives; UI should also prevent them) ----
  const {
    outstandingBalance,
    remainingTermMonths,
    aprPercent,
    monthlyOverpayment
  } = input || {};

  const bad =
    outstandingBalance == null || remainingTermMonths == null || aprPercent == null || monthlyOverpayment == null ||
    !Number.isFinite(outstandingBalance) || outstandingBalance < 0 ||
    !Number.isFinite(aprPercent) || aprPercent < 0 ||
    !Number.isInteger(remainingTermMonths) || remainingTermMonths < 1 ||
    !Number.isFinite(monthlyOverpayment) || monthlyOverpayment < 0;

  if (bad) {
    throw new Error("Invalid inputs: values must be finite; balances/rates/overpayment >= 0; months >= 1.");
  }

  const loan = new Loan({
    principal: Money.fromPounds(outstandingBalance),
    remainingMonths: remainingTermMonths,
    aprPercent
  });

  const sim = new OverpaymentSimulator(loan);

  // Baseline (no overpayment)
  const base = sim.simulate(Money.fromPounds(0));

  // With overpayment
  const withOver = sim.simulate(Money.fromPounds(monthlyOverpayment));

  const interestSaved = Math.max(0, base.totalInterest - withOver.totalInterest);
  const monthsSaved = Math.max(0, base.months - withOver.months);

  return {
    baseline: base,
    withOverpay: withOver,
    interestSaved,
    monthsSaved,
    schedule: withOver.schedule
  };
}

// Named exports in case you want OOP access in tests later
export { Money, Loan, OverpaymentSimulator };
