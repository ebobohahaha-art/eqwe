> USD update: the portal and admin now show service dollars. 10,000,000 internal ledger units = $10 service balance, with the same $0.20 provider-cost cap. See [USD-BALANCE.md](USD-BALANCE.md). Command-line scripts still use internal ledger units.

# Administration

Open `/admin` on the same HTTPS site as the customer portal. The planned new URL is `https://oopengate.vercel.app/admin`; the domain move is performed separately.

## Setup

Use the existing PostgreSQL schema and `DATABASE_URL`. Set `ADMIN_ACCESS_KEY` to a private administrator key in the deployment runtime. `npm run admin-key` generates a new admin key if needed; generating one does not update deployment settings automatically. A customer key cannot unlock administration.

No new schema migration or dependency is required for this upgrade. Deploy the full source, including `lib/admin-queries.mjs` and `netlify/functions/admin.mjs`.

## Customer management

- Search all customers by name or account ID, filter active/revoked/depleted accounts, and sort by creation date, name or available balance.
- Move through paginated results. Summary totals describe all matching customers, not just the current page.
- Create a customer with an initial credit grant and purchase reference. Copy the one-time key before clearing it; plaintext keys cannot be recovered or listed later.
- Grant credits or revoke access using the in-page confirmation form. Each change uses the existing transactional audit and operation ID protection.
- Open Details for the latest 50 credit events, administrator changes and outstanding request reservations for that account.
- Export the current search/filter result to CSV, up to 10,000 customers. Exported customer names are protected against spreadsheet formulas, and keys are never included.
- Recheck gateway configuration independently of loading the customer list. This can report missing database configuration even when customer queries cannot run.

## Retries and locking

If a write times out, keep the form unchanged and use Retry same operation. The same operation ID is retained in memory, so a completed write cannot grant credits twice. A 409 means the operation already reached the server: the customer list is refreshed and the completed action form closes. If a create response was lost, its plaintext key cannot be recovered.

The key stays in this tab's memory and is cleared by Lock admin, page refresh or the 15-minute session lock. HTTP pages cannot authenticate. Customer requests never gain administrator privileges. Revoking an account prevents future admission but does not cancel provider jobs already in progress.

See DOMAIN-MOVE.md for the later move to oopengate.vercel.app.
