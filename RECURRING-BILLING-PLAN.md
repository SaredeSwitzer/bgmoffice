# Recurring CC billing (Stripe) — plan

**Sarede's top priority.** Replace USAePay's weekly recurring card billing with Stripe
saved-card charging, inside BGM Office, on her live Stripe account.

## What already exists (reuse — most of the plumbing is here)
- **Live Stripe keys** in `app_settings` (pk_live / sk_live / whsec_). `getStripe()` in invoices.js.
- **Schedule module** = the source of "who owes what this week": `class_sessions` each carry
  `charge_amount` + `payment_method` ('Credit Card'/'CC'/'Zelle'/…). Sum the CC ones per client.
- **One-off pay flow** (SetupIntent/PaymentIntent + public_token pay page) — the pattern to mirror.
- **Invoices** already have `stripe_payment_intent_id` / `stripe_client_secret` (Stripe precedent).

## What's missing (build tomorrow)
1. **Card on file per client.** Migration `004_card_on_file.sql` adds to `clients`:
   `stripe_customer_id`, `card_brand`, `card_last4`, `card_saved_at`. (RLS already on the table.)
2. **Save-a-card flow (SetupIntent).** A hosted "save your card" page keyed on the client's
   `public token` (reuse the pay-page pattern, but SetupIntent not PaymentIntent). Client enters the
   card once → create Stripe Customer + attach PaymentMethod → store the ids/last4 on the client.
   (Sarede can also key a card herself if a client won't self-enter.)
3. **Weekly billing run — REVIEW-THEN-CHARGE (her explicit rule: never auto-fire).**
   a. Compute each CC client's week total from `class_sessions` (payment_method = Credit Card).
   b. Show Sarede a review list: client · ****last4 · amount · # classes → she confirms / edits / skips.
   c. On approve: charge each via Stripe PaymentIntent (`customer` + saved PM, `off_session:true,
      confirm:true`). Record as `invoice_payments` / mark paid.
   d. Declines → flag for follow-up (mirrors her USAePay "declines" handling).

## New endpoints
- `POST /api/clients/:id/setup-intent` → client_secret for saving a card.
- `POST /api/clients/:id/card` (or Stripe webhook) → persist customer + PM + last4.
- `GET  /api/billing/week?start=YYYY-MM-DD` → the review list (CC clients + computed totals).
- `POST /api/billing/charge` → charge the approved list off-session; returns per-client results.

## New UI
- **Client profile:** "Card on file" section (save/replace card via link or keyed; shows ****last4).
- **Billing page:** weekly review → approve → charge, with per-client success/decline results.
  (Slots next to the Schedule page; pulls the same week the Schedule shows.)

## Migrating existing cards off USAePay
Existing recurring clients' cards live in USAePay's vault. Two options:
- **(recommended) re-collect** via "save your card" links to active recurring clients — clean, each
  re-enters once, no regulated migration.
- (formal) Stripe's regulated card-migration from USAePay — weeks, paperwork. Only if re-collecting
  is impractical.

## Cost check
Off-session recurring on Stripe = standard **2.9% + 30¢** (NOT the 3.4% manual-keyed rate). That
beats her ~3% effective BMS rate — so recurring on Stripe is cheaper *and* removes the keying.

## Safety
The weekly run **prepares** charges, Sarede **approves**, then it charges — mirrors the USAePay
"pending billing → review → batch" flow she already trusts. No silent auto-charging.

## Build order (tomorrow)
1. Migration 004 (card fields) → run on Supabase.
2. Save-card page + setup-intent endpoint (test with a real card save).
3. Weekly review endpoint + Billing page.
4. Charge endpoint (off-session) — test one real charge end-to-end.
5. Onboard a few recurring clients (save-card links), then run the first weekly review with Sarede.
