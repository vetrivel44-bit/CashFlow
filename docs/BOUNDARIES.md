# Boundaries

Two kinds of limit live in this codebase. The first is scope, and it can change.
The second cannot.

## Scope, for now

This release tracks outstanding payments. It does not do billing, GST invoices,
stock, expiry, company schemes, salesman GPS or vehicle management. Those are
real problems in this business and they are not what this is.

The test for a new feature: does it help answer *who owes me how much, and for
how long*? If not, it belongs to a later system.

## The line that does not move

**Nothing in this system may support unbilled sales, hidden ledgers, parallel
books, or anything that helps anyone evade tax.**

That is enforced by the shape of the code, not only by intention:

- There is one `entries` table and one code path that writes to it. There is no
  second table, no "internal" flag, and no alternative entry kind.
- `routes/reports.js` has no filter parameter that can drop a shop or an entry.
  Every report is computed from every row.
- The exports contain the same rows the screen shows. There is no export mode
  that omits anything.
- There is no `DELETE` in this server, so a transaction cannot be made to
  disappear after the fact. It can only be reversed, and a reversal is two
  visible rows.
- The printed sheet carries no GST number, no invoice number, no tax breakdown
  and no signature line, so it cannot be passed off as a bill.

If a future change would require adding a way to hide a row, the change is
wrong. Say so and stop.

The owner keeps GST filing in his notebook with his accountant. This system does
not try to take that over, and the `.xlsx` export exists so the accountant can
work the way he already works.
