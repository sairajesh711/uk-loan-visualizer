// apps/web/main.ts

// The .js extension is required for browser ES modules.
// Your bundler/compiler will know how to resolve this to the .ts file.
import { calculateDualLedgerJourney } from '../../packages/engine/src/index.js';
import type { Inputs, DualLedgerOutput } from '../../packages/engine/src/types';

// Tell TypeScript that Chart.js is available globally on the window object
declare const Chart: any;

let engine: { calculateDualLedgerJourney: (inputs: Inputs) => DualLedgerOutput } | null = null;

const $ = (s: string): HTMLElement | null => document.querySelector(s);
const fmtGBP = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString("en-GB", { style:"currency", currency:"GBP", maximumFractionDigits:0 });
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const addMonths = (d: Date, m: number): Date => { const x = new Date(d.getTime()); const day = x.getDate(); x.setMonth(x.getMonth() + m); if (x.getDate() < day) x.setDate(0); return x; };
const mmmYYYY = (d: Date) => d.toLocaleDateString("en-GB", { month:"short", year:"numeric" });

// Elements
const elTypeMortgage = $<HTMLInputElement>("#loanType-mortgage");
const elTypePersonal = $<HTMLInputElement>("#loanType-personal");
const elOutstanding = $<HTMLInputElement>("#outstandingBalance");
const elMonths = $<HTMLInputElement>("#remainingTermMonths");
const elApr = $<HTMLInputElement>("#interestApr");
const elOverpay = $<HTMLInputElement>("#overpayMonthly");
const elOverpayValue = $<HTMLSpanElement>("#overpayValue");
const elExpectedReturn = $<HTMLInputElement>("#expectedReturn");
const elExpectedReturnValue = $<HTMLSpanElement>("#expectedReturnValue");

const kpiRequired = $<HTMLElement>("#kpi-requiredPayment");
const kpiOverpay = $<HTMLElement>("#kpi-overpay");
const kpiOutflow = $<HTMLElement>("#kpi-outflow");

const outPayoffDate = $<HTMLElement>("#result-payoffDate");
const outInterestSaved = $<HTMLElement>("#result-interestSaved");
const outMonthsSaved = $<HTMLElement>("#result-monthsSaved");
const outOverpayPot = $<HTMLElement>("#result-overpayPot");
const outInvestPot = $<HTMLElement>("#result-investPot");
const outBreakEven = $<HTMLElement>("#result-breakEvenRate");
const chipOriginal = $<HTMLElement>("#chip-originalPayoff");
const chipExpected = $<HTMLElement>("#chip-expectedReturn");

const decisionBanner = $<HTMLElement>("#decisionBanner");
const decisionTitle = $<HTMLElement>("#decisionTitle");
const decisionDelta = $<HTMLElement>("#decisionDelta");

const banner = $<HTMLElement>("#errorBanner");
const bannerText = $<HTMLElement>("#errorText");

let balanceChart: any = null, oppLineChart: any = null;

const placeholders = {
  mortgage: { outstanding:"250000", months:"300", apr:"4.25", sliderMax:5000, sliderStep:50 },
  personal: { outstanding:"10000", months:"60", apr:"9.9", sliderMax:1000, sliderStep:25 },
};
const DEFAULT_RECOMMENDED_RATE = 5.0;

function showError(msg: string){ if(bannerText) bannerText.textContent=String(msg||"Invalid input."); banner?.classList.remove("d-none"); }
function clearError(){ if(bannerText) bannerText.textContent=""; banner?.classList.add("d-none"); }

if (window.Chart && (window as any)["chartjs-plugin-annotation"]) {
  Chart.register((window as any)["chartjs-plugin-annotation"]);
}

async function loadEngine(){
  try {
    engine = await import('../../packages/engine/src/index.js');
  } catch(e){
    showError("Engine failed to load. Please build it and reload.");
    console.error(e);
  }
}
loadEngine();

function applyTypeUI(){
  const type = elTypeMortgage?.checked ? "mortgage" : "personal";
  const p = placeholders[type];
  if(!elOutstanding || !elMonths || !elApr || !elOverpay || !elExpectedReturn || !elOverpayValue || !elExpectedReturnValue) return;

  elOutstanding.placeholder = p.outstanding;
  elMonths.placeholder = p.months;
  elApr.placeholder = p.apr;
  elOverpay.max = String(p.sliderMax);
  elOverpay.step = String(p.sliderStep);
  elOverpay.value = String(Math.min(Number(elOverpay.value||0), p.sliderMax));
  elOverpayValue.textContent = fmtGBP(Number(elOverpay.value||0));
  
  if (!elExpectedReturn.dataset.setOnce){
    elExpectedReturn.value = String(DEFAULT_RECOMMENDED_RATE);
    elExpectedReturnValue.textContent = `${DEFAULT_RECOMMENDED_RATE.toFixed(1)}%`;
    elExpectedReturn.dataset.setOnce = "1";
    activatePresetButton("risk-moderate");
  }
  recompute();
}

function readInputs(): Inputs {
    const outstanding = clamp(Number(elOutstanding?.value||elOutstanding?.placeholder||0), 0, Number.MAX_SAFE_INTEGER);
    const months = Math.max(1, Math.floor(Number(elMonths?.value||elMonths?.placeholder||1)));
    const apr = clamp(Number(elApr?.value||elApr?.placeholder||0), 0, 1000);
    const overpay = clamp(Number(elOverpay?.value||0), 0, Number(elOverpay?.max||5000));
    const expectedReturn = clamp(Number(elExpectedReturn?.value||0), 0, 100);

    if(elOutstanding && Number(elOutstanding.value)!==outstanding) elOutstanding.value=String(outstanding);
    if(elMonths && Number(elMonths.value)!==months) elMonths.value=String(months);
    if(elApr && Number(elApr.value)!==apr) elApr.value=String(apr);
    if(elOverpay && Number(elOverpay.value)!==overpay) elOverpay.value=String(overpay);
    return { outstandingBalance:outstanding, remainingTermMonths:months, aprPercent:apr, monthlyOverpayment:overpay, expectedAnnualReturnPercent:expectedReturn };
}

let scheduled=false;
function schedule(){ if(scheduled) return; scheduled=true; queueMicrotask(()=>{scheduled=false; recompute();}); }

function clearOutputs(){
    const outputs = [outPayoffDate, outInterestSaved, outMonthsSaved, outOverpayPot, outInvestPot, outBreakEven, chipOriginal, kpiRequired, kpiOutflow];
    outputs.forEach(el => { if(el) el.textContent="—"; });

    if(decisionTitle) decisionTitle.textContent = "Enter your loan details";
    if(decisionDelta) decisionDelta.textContent = "";
    if(decisionBanner) decisionBanner.className = "decision tie";

    if(balanceChart) { balanceChart.data.labels=[]; balanceChart.data.datasets.forEach((d:any)=>d.data=[]); balanceChart.update(); }
    if(oppLineChart) { oppLineChart.data.labels=[]; oppLineChart.data.datasets.forEach((d:any)=>d.data=[]); oppLineChart.update(); }
}

function buildBalanceSeries(res: DualLedgerOutput){
  const L = Math.max(res.baseline.months, res.withOverpay.months);
  const labels = Array.from({length:L+1}, (_,i)=>i);
  const start = res.baseline.schedule[0]?.balance ?? 0;
  const baseBalances = [start, ...res.baseline.schedule.map(e=>e.balance)];
  const overBalances = [start, ...res.withOverpay.schedule.map(e=>e.balance)];
  while(baseBalances.length < labels.length) baseBalances.push(null);
  while(overBalances.length < labels.length) overBalances.push(null);
  return { labels, baseBalances, overBalances, baseMonths:res.baseline.months, overMonths:res.withOverpay.months };
}

function buildApplesSeries(res: DualLedgerOutput){
  const N = res.fair.investPath.months;
  const M = res.withOverpay.months;
  const labels = Array.from({length:N}, (_,i)=>i+1);
  const wealthInvest = res.fair.investPath.schedule.map(p=>p.wealth);
  const wealthOverpay = res.fair.overpayPath.schedule.map(p=>p.wealth);
  return { labels, wealthInvest, wealthOverpay, M, N };
}

function upsertBalanceChart(series: any){
  const ctx = ($("#balanceChart") as HTMLCanvasElement)?.getContext("2d"); if(!ctx || !Chart) return;
  const annotations = {
    base: { type:"line", xMin:series.baseMonths, xMax:series.baseMonths, borderColor:"rgba(239,68,68,.7)", borderWidth:2,
      label:{enabled:true, content:`Original: ${mmmYYYY(addMonths(new Date(), series.baseMonths))}`} },
    over: { type:"line", xMin:series.overMonths, xMax:series.overMonths, borderColor:"rgba(34,197,94,.7)", borderWidth:2,
      label:{enabled:true, content:`Overpay: ${mmmYYYY(addMonths(new Date(), series.overMonths))}`} }
  };
  if(!balanceChart){
    balanceChart = new Chart(ctx, {
      type:"line", data:{ labels: series.labels,
        datasets:[
          { label:"Original Balance", data:series.baseBalances, borderWidth:2, pointRadius:0, tension:.15, borderColor:"rgb(239,68,68)", backgroundColor:"rgba(239,68,68,.1)" },
          { label:"Overpayment Balance", data:series.overBalances, borderWidth:2, pointRadius:0, tension:.15, borderColor:"rgb(34,197,94)", backgroundColor:"rgba(34,197,94,.1)" },
        ]},
      options:{
        responsive:true, animation:false, interaction:{mode:"index", intersect:false},
        scales:{ x:{ title:{display:true, text:"Months from now"} },
                 y:{ title:{display:true, text:"Outstanding balance (£)"}, ticks:{ callback:(v: number)=>fmtGBP(v) } } },
        plugins:{ tooltip:{ callbacks:{ label:(c:any)=>`${c.dataset.label}: ${fmtGBP(c.parsed.y)}` } }, legend:{display:true}, annotation:{annotations} }
      }
    });
  } else {
    balanceChart.data.labels = series.labels;
    balanceChart.data.datasets[0].data = series.baseBalances;
    balanceChart.data.datasets[1].data = series.overBalances;
    balanceChart.options.plugins.annotation = { annotations };
    balanceChart.update();
  }
}

function upsertWealthChart(series: any){
    const ctx = ($("#oppLineChart") as HTMLCanvasElement)?.getContext("2d"); if(!ctx || !Chart) return;
    const ann = {
      annotations:{
        phase:{ type:"box", xMin: series.M, xMax: series.N, backgroundColor:"rgba(34,197,94,0.06)", borderWidth:0 },
        mline:{ type:"line", xMin: series.M, xMax: series.M, borderColor:"rgba(34,197,94,.7)", borderWidth:2, label:{enabled:true, content:`Loan cleared (month ${series.M})`} }
      }
    };
    if(!oppLineChart){
      oppLineChart = new Chart(ctx, {
        type:"line", data:{ labels: series.labels,
          datasets:[
            { label:"Net Wealth (Invest Path)", data:series.wealthInvest, borderWidth:2, pointRadius:0, tension:.15, borderColor:"rgb(59,130,246)", fill:false },
            { label:"Net Wealth (Overpay Path)", data:series.wealthOverpay, borderWidth:2, pointRadius:0, tension:.15, borderColor:"rgb(34,197,94)", fill:false },
          ]},
        options:{
          responsive:true, animation:false, interaction:{mode:"index", intersect:false},
          scales:{ x:{ title:{display:true, text:"Months from now (Original Loan Term)"} },
                   y:{ title:{display:true, text:"Net Wealth (£)"}, beginAtZero:true, ticks:{ callback:(v:number)=>fmtGBP(v) } } },
          plugins:{ tooltip:{ callbacks:{ label:(c:any)=>`${c.dataset.label}: ${fmtGBP(c.parsed.y)}` } }, legend:{display:true}, annotation:ann }
        }
      });
    } else {
      oppLineChart.data.labels = series.labels;
      oppLineChart.data.datasets[0].data = series.wealthInvest;
      oppLineChart.data.datasets[1].data = series.wealthOverpay;
      oppLineChart.options.plugins.annotation = ann;
      oppLineChart.update();
    }
}

function updateDecision(delta: number){
  if (!decisionTitle || !decisionDelta || !decisionBanner) return;
  if (Math.abs(delta) < 1000){
    decisionTitle.textContent = "It's a close call";
    decisionDelta.textContent = "Outcomes are very similar";
    decisionBanner.className = "decision tie";
  } else if (delta > 0){
    decisionTitle.textContent = "Overpaying looks stronger";
    decisionDelta.textContent = `by ≈ ${fmtGBP(delta)}`;
    decisionBanner.className = "decision win-overpay";
  } else {
    decisionTitle.textContent = "Investing looks stronger";
    decisionDelta.textContent = `by ≈ ${fmtGBP(-delta)}`;
    decisionBanner.className = "decision win-invest";
  }
}

function recompute(){
    clearError();
    if (elOverpayValue) elOverpayValue.textContent = fmtGBP(Number(elOverpay?.value||0));
    if (elExpectedReturnValue) elExpectedReturnValue.textContent = `${Number(elExpectedReturn?.value||0).toFixed(1)}%`;
    if(!engine) { return; }

    const inputs = readInputs();
    if(!Number.isFinite(inputs.outstandingBalance) || inputs.outstandingBalance <= 0){
      clearOutputs();
      return;
    }

    try {
      const res: DualLedgerOutput = engine.calculateDualLedgerJourney(inputs);

      const R = res.requiredMonthlyPayment;
      if (kpiRequired) kpiRequired.textContent = fmtGBP(R);
      if (kpiOverpay) kpiOverpay.textContent = fmtGBP(inputs.monthlyOverpayment);
      if (kpiOutflow) kpiOutflow.textContent = fmtGBP(R + inputs.monthlyOverpayment);

      if (outPayoffDate) outPayoffDate.textContent = mmmYYYY(addMonths(new Date(), res.withOverpay.months));
      if (outInterestSaved) outInterestSaved.textContent = fmtGBP(res.interestSaved);
      if (outMonthsSaved) outMonthsSaved.textContent = String(res.monthsSaved);
      if (outOverpayPot) outOverpayPot.textContent = fmtGBP(res.fair.atN.overpayPot);
      if (outInvestPot) outInvestPot.textContent = fmtGBP(res.fair.atN.investPot);

      const originalDate = mmmYYYY(addMonths(new Date(), res.baseline.months));
      if (chipOriginal) chipOriginal.textContent = originalDate;

      const rStar = res.fair.breakEvenAnnualReturnPercent;
      if (outBreakEven) outBreakEven.textContent = Number.isFinite(rStar) ? `${rStar.toFixed(2)}%` : "N/A";
      if (chipExpected) chipExpected.textContent = `${inputs.expectedAnnualReturnPercent.toFixed(1)}%`;

      const bal = buildBalanceSeries(res);
      upsertBalanceChart(bal);
      const apples = buildApplesSeries(res);
      upsertWealthChart(apples);
      
      updateDecision(res.fair.atN.delta);

    } catch(e: any){
      clearOutputs();
      showError(e?.message || "Could not compute results. Please check your inputs.");
      console.error(e);
    }
}

function activatePresetButton(id: string){
  ["risk-cautious","risk-moderate","risk-aggressive"].forEach(k=>{
    const btn = $(`#${k}`);
    if(!btn) return;
    (k===id) ? btn.classList.add("active") : btn.classList.remove("active");
  });
}

["risk-cautious","risk-moderate","risk-aggressive"].forEach(id=>{
  $(`#${id}`)?.addEventListener("click", (e)=>{
    const rate = Number((e.currentTarget as HTMLElement)?.dataset?.rate || 0);
    if(elExpectedReturn) elExpectedReturn.value = String(rate);
    if(elExpectedReturnValue) elExpectedReturnValue.textContent = `${rate.toFixed(1)}%`;
    activatePresetButton(id);
    recompute();
  });
});

[elTypeMortgage, elTypePersonal].forEach(el=>el?.addEventListener("change", applyTypeUI));
[elOutstanding, elMonths, elApr, elOverpay, elExpectedReturn].forEach(el => {
    el?.addEventListener("input", schedule);
    el?.addEventListener("change", schedule);
});

$("#preset-mortgage")?.addEventListener("click", ()=>{
    if(!elTypeMortgage || !elTypePersonal || !elOutstanding || !elMonths || !elApr || !elOverpay || !elExpectedReturn) return;
    elTypeMortgage.checked=true; elTypePersonal.checked=false;
    elOutstanding.value="250000"; elMonths.value="300"; elApr.value="4.5"; elOverpay.value="200";
    elExpectedReturn.value = "5.0";
    activatePresetButton("risk-moderate");
    applyTypeUI();
});

$("#preset-personal")?.addEventListener("click", ()=>{
    if(!elTypeMortgage || !elTypePersonal || !elOutstanding || !elMonths || !elApr || !elOverpay || !elExpectedReturn) return;
    elTypePersonal.checked=true; elTypeMortgage.checked=false;
    elOutstanding.value="10000"; elMonths.value="60"; elApr.value="9.9"; elOverpay.value="50";
    elExpectedReturn.value = "5.0";
    activatePresetButton("risk-moderate");
    applyTypeUI();
});

applyTypeUI();
