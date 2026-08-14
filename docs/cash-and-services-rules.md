# Cash, GCash & Prepaid Load — Business Rules

The authoritative statement of how money is counted. Before changing any of the
formulas below, read this file: several of them look wrong until you know which
pocket the money actually lands in.

The rules are enforced in:

- `src/models/cashReconciliations.js` — `getSalesTotals`, `computeExpectedCash`, `closeDay`
- `src/services/cashSummary.js` — the audit summary shown on screen and printed
- `src/models/reports.js` — the sales reports

---

## 1. The two pockets

Every GCash service transaction moves money between **two separate pockets**:

| Pocket | What it is |
|---|---|
| **Register cash** | Physical cash in the drawer. This is what gets counted at closing. |
| **E-money wallet** | The store's GCash balance. **Not tracked by this system.** |

A transaction that leaves the register does not necessarily leave the business,
and vice versa. Confusing the two is the single easiest way to break this module.

---

## 2. GCash cash impact

Fee rules live in `gcash_fee_rules` and are matched by service type and amount.

### Cash In — customer hands over cash, store sends e-money

```
principal 1,000 + fee 20 = gross 1,020

register cash   +1,020   (customer pays principal AND fee in cash)
e-money wallet  -1,000
                --------
business earns     +20
```

`cash_impact = +gross_amount`

### Cash Out — customer sends e-money, store hands over cash

```
principal 1,000 + fee 20 = gross 1,020

register cash   -1,000   (only the principal leaves the drawer)
e-money wallet  +1,020   (customer sends principal AND fee as e-money)
                --------
business earns     +20
```

`cash_impact = -principal_amount`

> **The fee is NOT deducted from register cash on a cash-out.** The customer pays
> it out of their GCash wallet, so it arrives as e-money. A cash-out of ₱1,000
> reduces the drawer by exactly ₱1,000, never ₱980 or ₱1,020.
>
> This was corrected once already — see `scripts/fixGcashCashOutImpact.js`.

## 3. Prepaid load cash impact

```
face value 100 + markup 3 = gross 103

register cash   +103
telco balance   -100
                --------
business earns    +3
```

`cash_impact = +gross_amount`

---

## 4. Expected cash on hand

```
expected = opening cash
         + cash sales                 (payments where payment_method = 'cash')
         + net other cash impact      (GCash cash-in gross
                                       - GCash cash-out principal
                                       + prepaid load gross)
         - cash expenses

variance = actual counted cash - expected
is_short = variance < 0
```

**All expenses are treated as cash paid out of the register.** The `expenses`
table has no payment-method column, so there is no way to tell a cash expense
from one paid by bank transfer. If that distinction ever matters, add
`payment_method` to `expenses` and filter on it in `getSalesTotals`.

### Bank deposits are deliberately excluded

Deposits are made **after** the closing count, so the cash is still in the drawer
when it is counted. Subtracting them would make every deposit day report a false
shortage. They reduce `remaining_cash_on_register` instead:

```
remaining_cash_on_register = max(actual_cash_on_hand - bank deposits, 0)
```

If the business ever starts depositing mid-day, this rule must change — deposits
would then need to be subtracted from expected cash, and probably timestamped so
only pre-count deposits are counted.

### The audit summary must balance

`src/services/cashSummary.js` guarantees:

```
opening_cash_total + total_cash_inflows - total_cash_outflows == expected_cash_on_hand

  inflows  = cash sales + GCash cash-in gross + prepaid load gross
  outflows = GCash cash-out principal + cash expenses
```

Bank deposits appear as their own field, outside this identity.

---

## 5. What counts as "sales"

**Total sales measures throughput — the full value transacted at the counter —
not margin.** Services are counted at their full gross amount:

| Transaction | Contributes to sales |
|---|---|
| Merchandise order ₱1,000 | ₱1,000 |
| Prepaid load, face ₱100 + markup ₱3 | ₱103 |
| GCash cash-in ₱1,000 + fee ₱20 | ₱1,020 |
| GCash cash-out ₱1,000 + fee ₱20 | ₱1,020 |

Both GCash directions count, because both represent value transacted.

The consequence worth knowing: **sales figures are not profit figures.** The
business actually earned ₱23 in the load + GCash rows above, not ₱1,123. The
margin is recorded (`gcash_transactions.fee_amount`,
`prepaid_load_transactions.markup_amount`) but is not currently aggregated into
any report. See Known gaps.

`total_sales_amount` on a reconciliation record uses this same definition, so it
agrees with `/reports/sales/overview` for the same branch and day. It is a
display field only — expected cash is derived from `cash_sales_amount` and
`other_cash_impact_amount`, never from `total_sales_amount`.

### Payment method breakdown

`/reports/sales/payments` reports four kinds of row:

- the real `payments.payment_method` values (`cash`, `gcash`, `bank_transfer`, …)
- `prepaid_load` — prepaid load transactions at gross
- `gcash_service` — GCash cash-in/cash-out at gross

`gcash` and `gcash_service` are **different things**: `gcash` is a retail order
settled by GCash transfer; `gcash_service` is a cash-in/cash-out service. Do not
merge them.

---

## 6. Closing a day

- A day is opened once per branch per date (`UNIQUE(branch_id, business_date)`).
- Opening cash can be edited until the day is closed.
- **Closing is final.** Re-closing returns `409 this day is already closed`.
- `GET /cash-reconciliations/:id/preview` returns the totals `closeDay` would
  compute, without writing. The Closing screen reads this so the expected cash a
  cashier approves is exactly what gets stored — the screen must never re-derive
  these figures itself.

---

## 7. Known gaps

- **No e-wallet float tracking.** Nothing records the GCash or telco balance, so
  the system cannot answer "how much float is left?" A cash-in silently depletes
  e-money and a cash-out silently accumulates it, with no visibility.
- **Service margin is never reported.** `fee_amount` and `markup_amount` are
  stored per transaction but aggregated nowhere. There is no "what did GCash earn
  this month" figure.
- **Double-count risk.** `gcash_transactions.order_id` and
  `prepaid_load_transactions.order_id` are user-settable and nothing
  de-duplicates. Ringing a load up as a POS order *and* logging the prepaid
  transaction against it counts the cash twice — once in `cash_sales_amount`,
  once in `other_cash_impact_amount`. Not reachable through the current POS flow.
- **`/reports/sales*` routes are unauthenticated** while neighbouring routes
  require auth.
- **`DELETE /cash-reconciliations/:id`** has no role check; any authenticated
  user can delete a closed day.
