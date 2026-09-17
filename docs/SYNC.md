# How two phones stay in agreement

The delivery areas have poor network. The phones are the source of truth for
what happened; the server is where they agree about it.

## The three properties that remove conflicts

**Entries are immutable.** An entry records a fact that already happened — this
shop was given goods, this shop handed over cash. Facts do not get edited. The
only field that can ever change is `reversed_by`, it can only go from empty to
set, and only once.

**Ids come from the phone.** A payment gets its id the moment the staff member
taps Save, before any network call. Pushing the same entry twice is therefore a
no-op on the server, which means a phone that loses signal mid-push can retry
the whole batch forever and never double-count a payment. This one property is
what lets the sync loop be as simple as it is.

**No total is synced.** Balances, day counts and the outstanding list are
derived from the entries on every read. Two phones cannot disagree about a
number that neither of them stores.

What is left mutable is shops and routes — a name, a phone number, a route.
Those are last-write-wins on `updated_at`. The worst case is a rename racing a
rename, and the loser is in the audit table.

## The wire

Pull: `GET /api/sync?since=N` returns every row written after sequence N, in
order. N is a server-assigned counter, not a timestamp, so two phones with wrong
clocks still agree on the order the server accepted things in.

Push: `POST /api/sync` with `{routes, shops, entries, reversals}`. The response
gives a result per item rather than failing the batch, so one bad row never
blocks the eleven good ones behind it:

| status | meaning |
| --- | --- |
| `ok` | applied |
| `duplicate` | already had it — a retry, not a mistake |
| `stale` | an older version of a shop or route; ignored |
| `already_reversed` | someone else corrected it first |
| `rejected` | it will never be accepted; the reason is in `reason` |

The client clears all five from its outbox. A `rejected` row is settled too:
retrying it forever would block everything queued behind it. It stays in the
local ledger and in the audit trail, and the mismatch surfaces the next time
someone opens that shop.

## Ordering

Entries are pushed before reversals in the same batch, because a correction and
the entry it corrects can be made seconds apart and the correction has to exist
before anything can point at it.

## What is deliberately missing

No conflict resolution UI, no merge dialogue, no "this shop changed on another
phone" prompt. None of it is needed, and every one of them would be a screen
asking a distributor to adjudicate something he should never have been shown.
