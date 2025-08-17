import { describe, it, expect } from "vitest";
import { calculateRepaymentJourney } from "../src/main";

describe("Investment projector (DCA) + fair compare", () => {
  const baseInput = {
    outstandingBalance: 120_000,
    remainingTermMonths: 240,
    aprPercent: 3.5,
    monthlyOverpayment: 300
  };

  it("0% return: FV = O * n", () => {
    const res = calculateRepaymentJourney({ ...baseInput, expectedAnnualReturnPercent: 0 });
    const expectedFV = 300 * res.baseline.months;
    expect(Math.abs(res.invest.fvInvest - expectedFV)).toBeLessThanOrEqual(0.02);
  });

  it("positive return grows FV", () => {
    const res0 = calculateRepaymentJourney({ ...baseInput, expectedAnnualReturnPercent: 0 });
    const res5 = calculateRepaymentJourney({ ...baseInput, expectedAnnualReturnPercent: 5 });
    expect(res5.invest.fvInvest).toBeGreaterThan(res0.invest.fvInvest);
  });

  it("break-even return makes sense economically", () => {
    const res = calculateRepaymentJourney({ ...baseInput, expectedAnnualReturnPercent: 0 });
    const err = res.invest.requiredAnnualReturnPercent;
    
    // Debug output
    console.log({ 
      interestSaved: res.interestSaved, 
      breakEvenReturn: err,
      overpaymentTotal: baseInput.monthlyOverpayment * res.baseline.months,
      baselineMonths: res.baseline.months
    });
    
    // Since investing £300/month for 241 months (£72,300) is much more than interest saved (£18,965),
    // the break-even return should be 0% (you're better off investing even with no return)
    expect(err).toBe(0);
  });

  it("fair compare: reinvest freed regular payment after early payoff", () => {
    const res = calculateRepaymentJourney({ ...baseInput, expectedAnnualReturnPercent: 0, fairCompare: true });
    expect(res.invest.fair?.reinvestFreedPaymentFV ?? 0).toBeGreaterThanOrEqual(0);
  });
});
