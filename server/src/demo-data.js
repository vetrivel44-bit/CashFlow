/**
 * Sample data: a small engineering job-work business in Coimbatore.
 *
 * It is built to be honest rather than flattering. The business is real-shaped
 * — decent revenue, thin cash, customers who pay late — so the dashboard opens
 * on AMBER with a genuine problem to look at, not on a green tick that teaches
 * the owner nothing.
 *
 * The numbers are ordinary for an SME of this size: about ₹9L of monthly
 * billing, ₹7L of monthly costs, and two customers who are slow payers.
 */

import { addDays, today as todayISO } from "../../shared/money.js";

export function demoData(asOf = todayISO()) {
  const day = (n) => addDays(asOf, n);
  const transactions = [];
  const invoices = [];
  const scheduled = [];

  // --- six months of history, so recurring costs can be detected -----------
  for (let month = 6; month >= 1; month--) {
    const anchor = -month * 30;

    // Salaries on the 1st-ish, the largest fixed cost.
    transactions.push({ date: day(anchor + 1), direction: "out", amount: 385000, category: "salary", counterparty: "Staff salaries" });
    // Rent.
    transactions.push({ date: day(anchor + 3), direction: "out", amount: 85000, category: "rent", counterparty: "Factory rent" });
    // Power, which moves around a bit.
    transactions.push({ date: day(anchor + 8), direction: "out", amount: 62000 + (month % 3) * 4000, category: "utilities", counterparty: "TNEB" });
    // Raw material from the regular supplier.
    transactions.push({ date: day(anchor + 12), direction: "out", amount: 140000 + (month % 2) * 15000, category: "materials", counterparty: "Sri Steel Traders" });
    // GST.
    transactions.push({ date: day(anchor + 18), direction: "out", amount: 74000, category: "tax", counterparty: "GST payment" });
    // Machinery loan.
    transactions.push({ date: day(anchor + 5), direction: "out", amount: 96000, category: "loan_emi", counterparty: "Equipment loan EMI" });

    // Collections from the three steady customers. Together these slightly
    // exceed the monthly costs above — the business is viable. Its trouble is
    // timing, not margin, which is the problem this app can actually help
    // with. A demo business that loses money every month would open RED with
    // nothing the owner could do about it.
    transactions.push({ date: day(anchor + 14), direction: "in", amount: 420000, category: "sales", counterparty: "Vibgyor Engineering" });
    transactions.push({ date: day(anchor + 22), direction: "in", amount: 310000, category: "sales", counterparty: "Anand Auto Components" });
    transactions.push({ date: day(anchor + 26), direction: "in", amount: 205000, category: "sales", counterparty: "KPR Fabricators" });
  }

  // --- invoices raised and not yet settled --------------------------------
  // Two badly overdue, which is where the trouble comes from.
  invoices.push(
    { number: "INV-2041", customer: "Vibgyor Engineering", issue_date: day(-68), due_date: day(-38), amount: 465000 },
    { number: "INV-2048", customer: "Nachimuthu Industries", issue_date: day(-59), due_date: day(-29), amount: 288000 },
    { number: "INV-2055", customer: "Anand Auto Components", issue_date: day(-44), due_date: day(-14), amount: 342000 },
    { number: "INV-2061", customer: "KPR Fabricators", issue_date: day(-31), due_date: day(-1), amount: 196000 },
    { number: "INV-2067", customer: "Vibgyor Engineering", issue_date: day(-18), due_date: day(12), amount: 510000 },
    { number: "INV-2072", customer: "Sakthi Precision", issue_date: day(-9), due_date: day(21), amount: 274000 },
    // Settled ones, so the app can learn how late this lot actually pay.
    { number: "INV-2030", customer: "Anand Auto Components", issue_date: day(-96), due_date: day(-66), amount: 310000, paid_amount: 310000, paid_date: day(-52) },
    { number: "INV-2035", customer: "KPR Fabricators", issue_date: day(-84), due_date: day(-54), amount: 225000, paid_amount: 225000, paid_date: day(-43) },
    { number: "INV-2038", customer: "Vibgyor Engineering", issue_date: day(-76), due_date: day(-46), amount: 420000, paid_amount: 420000, paid_date: day(-31) }
  );

  // --- what is already committed over the next quarter --------------------
  for (let m = 0; m < 3; m++) {
    const base = m * 30;
    scheduled.push(
      { label: "Staff salaries", category: "salary", amount: 385000, due_date: day(base + 2), essential: true },
      { label: "Equipment loan EMI", category: "loan_emi", amount: 96000, due_date: day(base + 6), essential: true },
      { label: "GST payment", category: "tax", amount: 74000, due_date: day(base + 19), essential: true },
      { label: "Factory rent", category: "rent", amount: 85000, due_date: day(base + 4), essential: false },
      { label: "Sri Steel Traders — raw material", category: "materials", amount: 155000, due_date: day(base + 11), essential: false },
      { label: "TNEB electricity", category: "utilities", amount: 64000, due_date: day(base + 9), essential: false }
    );
  }
  // A one-off that lands at exactly the wrong moment.
  scheduled.push({ label: "New lathe — second instalment", category: "capex", amount: 350000, due_date: day(16), essential: false });

  return {
    businessName: "Kumaran Engineering Works",
    openingBalance: 640000,
    transactions,
    invoices,
    scheduled,
    counts: { transactions: transactions.length, invoices: invoices.length, scheduled: scheduled.length }
  };
}
