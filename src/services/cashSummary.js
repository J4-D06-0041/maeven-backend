function toMoney(value) {
  const n = Number(value || 0);
  if (Number.isNaN(n)) return 0;
  return Number(n.toFixed(2));
}

/**
 * Build the cash audit summary for a reconciliation row.
 *
 * The figures satisfy:
 *   opening_cash_total + total_cash_inflows - total_cash_outflows
 *     === expected_cash_on_hand
 *
 * Cash flows counted:
 *   in  - cash sales, GCash cash-in (gross: principal + fee both arrive as cash),
 *         prepaid load (gross: face value + markup)
 *   out - GCash cash-out (principal only; the fee is received as e-money,
 *         not taken from the register), cash expenses
 *
 * Bank deposits are NOT an outflow here. They are made after the closing count,
 * so they reduce remaining_cash_on_register instead and are reported separately.
 */
function buildAuditSummary(data = {}) {
  const openingCash = toMoney(data.opening_cash_total);
  const cashSales = toMoney(data.cash_sales_amount);
  const cashIn = toMoney(data.gcash_cash_in_total);
  const cashOut = toMoney(data.gcash_cash_out_total);
  const prepaidLoadTotal = toMoney(data.prepaid_load_total);
  const totalExpenses = toMoney(data.total_expenses_amount);
  const bankDeposits = toMoney(data.total_bank_deposit_amount);
  const otherNet = toMoney(data.other_cash_impact_amount);

  const totalCashInflows = toMoney(cashSales + cashIn + prepaidLoadTotal);
  const totalCashOutflows = toMoney(cashOut + totalExpenses);

  return {
    opening_cash_total: openingCash,
    cash_sales_amount: cashSales,
    gcash_cash_in_total: cashIn,
    gcash_cash_out_total: cashOut,
    prepaid_load_total: prepaidLoadTotal,
    total_expenses_amount: totalExpenses,
    total_bank_deposit_amount: bankDeposits,
    net_other_cash_impact_amount: otherNet,
    total_cash_inflows: totalCashInflows,
    total_cash_outflows: totalCashOutflows,
    expected_cash_on_hand: toMoney(data.expected_cash_on_hand),
    actual_cash_on_hand: toMoney(data.actual_cash_on_hand),
    remaining_cash_on_register: toMoney(data.remaining_cash_on_register),
    variance_amount: toMoney(data.variance_amount),
    is_short: Boolean(data.is_short),
  };
}

module.exports = { buildAuditSummary, toMoney };
