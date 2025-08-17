import { describe, it, expect } from "vitest";
import { calculateRepaymentJourney } from "../src/main";

describe("calculateRepaymentJourney (TS)", () => {
  it("rejects negative inputs", () => {
    expect(() => calculateRepaymentJourney({
      outstandingBalance: -1, remainingTermMonths: 300, aprPercent: 4, monthlyOverpayment: 0
    })).toThrow();
  });

  it("zero overpayment ≈ baseline", () => {
    const res = calculateRepaymentJourney({
      outstandingBalance: 250_000,
      remainingTermMonths: 300,
      aprPercent: 4.25,
      monthlyOverpayment: 0
    });
    // Rounding can make it off-by-1; be tolerant.
    expect(Math.abs(res.baseline.months - 300)).toBeLessThanOrEqual(1);
    expect(res.interestSaved).toBe(0);
  });

  it("overpayment reduces months and interest", () => {
    const res = calculateRepaymentJourney({
      outstandingBalance: 250_000,
      remainingTermMonths: 300,
      aprPercent: 4.25,
      monthlyOverpayment: 200
    });
    expect(res.withOverpay.months).toBeLessThan(res.baseline.months);
    expect(res.withOverpay.totalInterest).toBeLessThan(res.baseline.totalInterest);
  });

  it("principal conservation (sum principal ≈ initial)", () => {
    const res = calculateRepaymentJourney({
      outstandingBalance: 120_000,
      remainingTermMonths: 240,
      aprPercent: 3.5,
      monthlyOverpayment: 300
    });
    const paidPrincipal = res.schedule.reduce((s, e) => s + e.principal, 0);
    expect(Math.abs(paidPrincipal - 120_000)).toBeLessThanOrEqual(0.02);
  });

  it("handles 0% APR", () => {
    const res = calculateRepaymentJourney({
      outstandingBalance: 12_000,
      remainingTermMonths: 24,
      aprPercent: 0,
      monthlyOverpayment: 0
    });
    expect(res.baseline.totalInterest).toBe(0);
    expect(Math.abs(res.baseline.months - 24)).toBeLessThanOrEqual(1);
  });
});
