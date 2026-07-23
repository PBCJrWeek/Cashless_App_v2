# Bible Camp Canteen App

Netlify-hosted React app with Supabase Free for camper balances, barcode checkout, deposits, and transaction reporting.

## Included features

- Staff email/password sign-in with Supabase Auth
- Camper search by ID, name, cabin, or barcode
- Camera barcode scanner for camper lookup
- Camera barcode scanner for item lookup and price loading
- Deposit money during the week
- Transaction report filtering and CSV export
- Store item catalog with barcode + price
- Safe atomic balance updates through a Supabase Postgres RPC
- Multi-item carts with one atomic order charge
- Printable scanner command barcodes for checkout, undo, and cancel
- CSV import for campers and store items with downloadable templates

## Stack

- Frontend: React + Vite
- Hosting: Netlify
- Database/Auth: Supabase Free
- Camera barcode scanning: `html5-qrcode`

## 1. Create the Supabase project

Create a Supabase Free project.

In **Authentication > Providers > Email**:
- Keep email/password enabled
- For fastest setup, you can disable email confirmation for staff

## 2. Run the SQL schema

Open the Supabase SQL Editor and run:

`supabase/schema.sql`

This creates:
- `campers`
- `store_items`
- `transactions`
- row-level security policies
- `apply_camper_transaction(...)` RPC
- sample campers and sample store items

For an existing development database, also apply migrations in `supabase/migrations`
in filename order. The scanner-cart workflow requires:

`supabase/migrations/20260723_scanner_cart_workflow.sql`

## 3. Configure the frontend

Copy `.env.example` to `.env` and fill in:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## 4. Run locally

```bash
npm install
npm run dev
```

## 5. Deploy to Netlify

Deploy this repo to Netlify.

Build settings:
- Build command: `npm run build`
- Publish directory: `dist`

Environment variables:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## How barcode flow works

### Camper lookup
Use either:
- a USB barcode scanner that types into the camper barcode field, or
- the camera scanner in the browser

By default, each camper barcode is the same as the camper ID. You can later print Code 128 labels using that value.

### Scanner-only cart checkout
Each store item has:
- item name
- barcode
- price

The normal scanner workflow is:

1. Scan a camper barcode.
2. Scan each store item. Repeated items increase the quantity.
3. Scan `PBC-CMD-CHECKOUT` to charge the complete order once.
4. The app clears the order and focuses the camper barcode field for the next customer.

The Purchase administration menu contains printable Code 128 command barcodes:

- `PBC-CMD-CHECKOUT` completes and charges the order.
- `PBC-CMD-UNDO` removes one of the most recently scanned item.
- `PBC-CMD-CANCEL` clears the order without charging it.

Checkout is performed by the `complete_camper_order(...)` database function. It
recalculates store-item prices from the database, checks the camper balance, saves
the order and its line items, creates one aggregate transaction, and updates the
balance in one atomic operation. A unique checkout token prevents duplicate charges
if the same request is retried.

## CSV import

The app now includes in-app CSV import for:
- campers
- store items

Camper CSV columns:
- required: `camper_id`, `full_name`
- optional: `cabin`, `barcode_value`, `starting_balance`

Store item CSV columns:
- required: `item_name`, `barcode_value`, `price`

Uploading the file will upsert rows into Supabase:
- campers match on `camper_id`
- store items match on `barcode_value`

## Reports

The report panel supports:
- all transactions
- charges only
- deposits only
- date range filters
- CSV export

## Operational notes

- Supabase Free is large enough for your expected camp usage.
- Free projects can pause after inactivity, so test sign-in and one sample transaction before camp starts.
- Camera scanning requires HTTPS in production, which Netlify provides by default.

## Recommended next additions

- CSV import for campers and store items
- Admin-only staff roles
- Refund / void transactions
- Printable barcode labels for campers and items
