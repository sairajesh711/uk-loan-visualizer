import type { LoanInput, RepaymentJourney, Simulation, ScheduleEntry } from "./types";

// ---------- Value Object ----------
export class Money {
  readonly pence: number;
  constructor(pence: number) {
    if (!Number.isFinite(pence)) throw new Error("Money: non-finite value");
    this.pence = Math.round(pence);
  }
  static fromPounds(amount: number): Money {
    if (!Number.isFinite(amount)) throw new Error("Money: invalid pounds");
    return new Money(Math.round(amount * 100));
  }
  static fromPence(p: number): Money { return new Money(p); }
  add(m: Money): Money { return Money.fromPence(this.pence + m.pence); }
  sub(m: Money): Money { return Money.fromPence(this.pence - m.pence); }
  min(m: Money): Money { return Money.fromPence(Math.min(this.pence, m.pence)); }
  max(m: Money): Money { return Money.fromPence(Math.max(this.pence, m.pence)); }
  isNegative(): boolean { return this.pence < 0; }
  isZero(): boolean { return this.pence === 0; }
  toNumber(): number { return this.pence / 100; } // pounds
  clampNonNegative(): Money { return this.pence < 0 ? Money.fromPence(0) : this; }
}

// ---------- Entity ----------
export class Loan {
  readonly principal: Money;
  readonly remainingMonths: number;
  readonly aprPercent: number;

  constructor(params: { principal: Money; remainingMonths: number; aprPercent: number }) {
    const { principal, remainingMonths, aprPercent } = params;
    if (!(principal instanceof Money)) throw new Error("Loan: principal must be Money");
    if (!Number.isInteger(remainingMonths) || remainingMonths < 1) throw new Error("Loan: remainingMonths must be >= 1");
    if (!Number.isFinite(aprPercent) || aprPercent < 0) throw new Error("Loan: aprPercent must be >= 0");
    this.principal = principal;
    this.remainingMonths = remainingMonths;
    this.aprPercent = aprPercent;
  }

  monthlyRate(): number {
    return this.aprPercent === 0 ? 0 : (this.aprPercent / 100) / 12;
  }

  requiredMonthlyPayment(): Money {
    // Amortize current outstanding over remainingMonths.
    const P = this.principal.toNumber(); // pounds
    const n = this.remainingMonths;
    const r = this.monthlyRate();
    let paymentPounds: number;
    if (r === 0) {
      paymentPounds = P / n;
    } else {
      const denom = 1 - Math.pow(1 + r, -n);
      paymentPounds = (P * r) / denom;
    }
    return Money.fromPounds(paymentPounds);
  }
}

// ---------- Domain Service ----------
export class OverpaymentSimulator {
  constructor(private readonly loan: Loan) {}

  simulate(monthlyOverpayment: Money): Simulation {
    if (monthlyOverpayment.isNegative()) throw new Error("monthlyOverpayment cannot be negative");

    const schedule: ScheduleEntry[] = [];
    const r = this.loan.monthlyRate();
    const requiredPay = this.loan.requiredMonthlyPayment();

    let balance = this.loan.principal;
    let month = 0;
    let totalInterest = Money.fromPence(0);

    const MAX_MONTHS = this.loan.remainingMonths + 6000; // safety cap

    while (!balance.isZero() && month < MAX_MONTHS) {
      const opening = balance;

      // Round monthly interest to the nearest penny (UK statements style)
      const interest = Money.fromPence(Math.round(opening.pence * r));

      const plannedPayment = requiredPay.add(monthlyOverpayment);
      let principalPay = plannedPayment.sub(interest);
      if (principalPay.isNegative()) principalPay = Money.fromPence(0);

      principalPay = principalPay.min(opening); // don't go below zero
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

// ---------- Facade: pure function ----------
export function calculateRepaymentJourney(input: LoanInput): RepaymentJourney {
  const {
    outstandingBalance,
    remainingTermMonths,
    aprPercent,
    monthlyOverpayment
  } = input;

  const invalid =
    !Number.isFinite(outstandingBalance) || outstandingBalance < 0 ||
    !Number.isFinite(aprPercent) || aprPercent < 0 ||
    !Number.isInteger(remainingTermMonths) || remainingTermMonths < 1 ||
    !Number.isFinite(monthlyOverpayment) || monthlyOverpayment < 0;

  if (invalid) {
    throw new Error("Invalid inputs: values must be finite; balances/rates/overpayment >= 0; months >= 1.");
  }

  const loan = new Loan({
    principal: Money.fromPounds(outstandingBalance),
    remainingMonths: remainingTermMonths,
    aprPercent
  });

  const sim = new OverpaymentSimulator(loan);
  const baseline = sim.simulate(Money.fromPounds(0));
  const withOverpay = sim.simulate(Money.fromPounds(monthlyOverpayment));

  const interestSaved = Math.max(0, baseline.totalInterest - withOverpay.totalInterest);
  const monthsSaved = Math.max(0, baseline.months - withOverpay.months);

  return {
    baseline,
    withOverpay,
    interestSaved,
    monthsSaved,
    schedule: withOverpay.schedule
  };
}

export type { LoanInput, RepaymentJourney, Simulation, ScheduleEntry };
