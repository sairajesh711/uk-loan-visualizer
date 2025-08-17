export interface LoanInput {
  outstandingBalance: number;       // pounds, >= 0
  remainingTermMonths: number;      // int, >= 1
  aprPercent: number;               // APR %, >= 0
  monthlyOverpayment: number;       // pounds, >= 0
}

export interface ScheduleEntry {
  monthIndex: number;
  openingBalance: number;     // pounds
  interest: number;           // pounds
  principal: number;          // pounds
  overpayment: number;        // pounds
  requiredPayment: number;    // pounds
  closingBalance: number;     // pounds
}

export interface Simulation {
  schedule: ScheduleEntry[];
  months: number;
  totalInterest: number;      // pounds
}

export interface RepaymentJourney {
  baseline: Simulation;
  withOverpay: Simulation;
  interestSaved: number;      // pounds
  monthsSaved: number;
  schedule: ScheduleEntry[];  // alias of withOverpay.schedule
}
