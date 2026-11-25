/**
 * SQL fragments that split a reconciliation day's bank deposits by WHEN they
 * were recorded relative to the day's close. See
 * docs/cash-and-services-rules.md, "Bank deposits".
 *
 *   before close - cash taken out of the drawer while the day was open. It is
 *                  gone before the closing count, so it is a cash outflow and
 *                  reduces expected cash on hand.
 *   after close  - cash taken from the counted closing amount. It reduces
 *                  remaining_cash_on_register instead.
 *
 * The split is by the deposit row's own created_at against cr.closed_at. A
 * row recorded after close can never move into "before close", so the figures
 * frozen into a closed day (expected cash, variance) stay consistent with its
 * audit summary forever. For an open day every deposit so far is "before
 * close": that is what closeDay will subtract.
 *
 * Every fragment expects the reconciliation row to be aliased `cr`.
 */

function sumDeposits(extraCondition = '') {
  return `COALESCE((
    SELECT SUM(bd.amount)
    FROM bank_deposits bd
    WHERE bd.branch_id = cr.branch_id
      AND bd.business_date = cr.business_date
      ${extraCondition}
  ), 0)`;
}

const DEPOSITS_TOTAL = sumDeposits();

const DEPOSITS_BEFORE_CLOSE = sumDeposits(
  "AND bd.created_at <= COALESCE(cr.closed_at, 'infinity'::timestamptz)"
);

const DEPOSITS_AFTER_CLOSE = sumDeposits(
  'AND cr.closed_at IS NOT NULL AND bd.created_at > cr.closed_at'
);

// Columns to splice into a SELECT over `cash_reconciliations cr`.
const DEPOSIT_COLUMNS = `
  ${DEPOSITS_TOTAL} AS total_bank_deposit_amount,
  ${DEPOSITS_BEFORE_CLOSE} AS bank_deposits_before_close_amount,
  ${DEPOSITS_AFTER_CLOSE} AS bank_deposits_after_close_amount,
  CASE
    WHEN cr.closed_at IS NULL THEN NULL
    ELSE GREATEST(COALESCE(cr.actual_cash_on_hand, 0) - ${DEPOSITS_AFTER_CLOSE}, 0)
  END AS remaining_cash_on_register
`;

module.exports = { DEPOSIT_COLUMNS };
