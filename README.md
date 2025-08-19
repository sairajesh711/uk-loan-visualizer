# UK Loan Visualizer

A financial decision tool that helps you compare **overpaying your loan** vs **investing the money** using apples-to-apples wealth comparison.

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/sairajesh711/uk-loan-visualizer.git
cd uk-loan-visualizer

# Start the application
npm run start
```

The app will be available at **http://localhost:3000**

## 💡 Key Features

- **Apples-to-Apples Comparison**: Both strategies run for the same timeframe (original loan term)
- **Fair Compounding**: Investment contributions happen at month-end for accurate comparison
- **Break-Even Analysis**: Calculates the exact return rate where strategies break even
- **Interactive Visualizations**: Real-time charts showing balance reduction and wealth comparison
- **Decision Support**: Clear recommendations based on financial outcomes

## 🏗️ Architecture

This is now a **simple standalone implementation**:

```
uk-loan-visualizer/
├── apps/web/
│   ├── index.html      # Main UI with Bootstrap styling
│   ├── main.js         # UI logic and chart rendering
│   └── engine.js       # Financial calculation engine (ES module)
├── package.json        # Simple project config
└── README.md
```

## 📊 How It Works

1. **Dual-Ledger Simulation**: Runs parallel simulations for debt reduction and investment growth
2. **Wealth Tracking**: Compares net wealth (investments - remaining debt) over time
3. **Break-Even Calculation**: Uses bisection search to find the return rate where outcomes are equal
4. **Visual Analysis**: Interactive Chart.js visualizations with crossover markers

## 🔧 Development

The project uses vanilla JavaScript with ES modules:

- **No build step required** - just serve the files
- **No dependencies** - uses CDN for Chart.js and Bootstrap
- **Module imports** - clean separation between engine and UI
- **TypeScript-style JSDoc** - for better code documentation

## 📈 Financial Modeling

The engine implements sophisticated financial calculations:

- **Loan Amortization**: Accurate interest and principal calculations
- **Investment Growth**: Compound interest with end-of-month contributions
- **Risk Analysis**: Sensitivity analysis and break-even computation
- **Fair Comparison**: Both paths track wealth for the original loan term

## 🎯 Use Cases

Perfect for UK borrowers deciding whether to:
- Overpay their mortgage vs invest in ISAs/pensions
- Pay off personal loans vs invest the money
- Compare different loan strategies with various return assumptions

---

**Note**: This tool provides educational analysis only. Always consult with a qualified financial advisor for personalized advice.
This project is a design-first, client-side application built to provide a clear, intuitive, and powerful answer to a common financial question for UK consumers with existing loans: "What is the smartest way to use my extra money to pay off my loan early?"

It intentionally avoids complex backend logic to focus on creating an exceptional user experience that empowers users to make informed financial decisions through data visualization and interaction design.

The Product Vision
While banks provide initial loan details, they rarely offer tools that help borrowers compare repayment strategies against other financial opportunities. This tool fills that gap.

The User Pain Point: Borrowers often hear that overpaying is a good idea, but the benefits feel abstract. Furthermore, they are left wondering: "Am I better off clearing my debt faster, or could my money be working harder for me if I invested it instead?"

Our Solution: A highly interactive, single-page application that provides instant visual feedback on three key financial scenarios: standard repayment, monthly overpayments, and investing the equivalent amount. By manipulating simple controls, users can immediately see:

Time Saved: An interactive chart dynamically shortens, showing how many years are cut from the loan term.

Interest Saved vs. Potential Gains: A clear comparison between the interest payments avoided by overpaying versus the potential returns from investing the same money.

Net Financial Position: A final, powerful summary showing which strategy leads to a better financial outcome over the original term of the loan.

Key Features & Design Philosophy
Minimalist UI: A clean, single-view interface that focuses the user's attention on the comparison between different financial strategies.

Trio of Interactive Tools:

Overpayment Slider: A simple, satisfying slider for setting a recurring monthly overpayment amount.

Early Settlement Calculator: An input field to model the impact of a one-off lump sum payment.

Opportunity Cost Visualizer: A powerful simulator that answers the question: "Should I overpay or invest?" It provides a side-by-side comparison of the financial outcome of overpaying the loan versus investing the same amount in a savings account (e.g., at 4.5% interest) or the stock market (e.g., at an average 7% return).

Real-time Charting: Using a library like Chart.js or D3.js to provide smooth, animated transitions as the data changes.

Mobile-First: Designed to be perfectly usable and beautiful on a mobile device.

No Data Storage: Purely a client-side calculator. User data is never stored, ensuring privacy and simplicity.

