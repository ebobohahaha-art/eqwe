import { randomUUID } from "node:crypto";
import { database } from "../../lib/db.mjs";
import { authorizeAdmin } from "../../lib/admin-auth.mjs";
import { mintKey, keyHash, positiveTokens } from "../../lib/keys.mjs";
import { inferenceStatus } from "../../lib/inference-status.mjs";
import { balances, customerColumns, customerFilter, listOptions } from "../../lib/admin-queries.mjs";

const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function authFailure(status) {
  switch (status) {
    case 503: return "ADMIN_ACCESS_KEY is missing or invalid in this site's Functions environment.";
    case 400: return "Use the HTTPS admin page.";
    case 401: return "Admin key does not match this site's ADMIN_ACCESS_KEY. Check the Production/Functions value and redeploy.";
    case 403: return "Admin write blocked: page origin does not match the API origin. Open the admin page on this same HTTPS site.";
    case 415: return "Admin write must use application/json.";
    default: return "Admin request rejected.";
  }
}

function databaseFailure(error) {
  // Return only a safe category to the browser; never expose SQL, hostnames,
  // credentials, or raw PostgreSQL error messages.
  if (error?.message === "database_not_configured") {
    return "DATABASE_URL is missing from this site's server environment variables.";
  }
  if (["42P01", "42703"].includes(error?.code)) {
    return "Database schema is missing or outdated. Run the current schema.sql against the database configured in DATABASE_URL, then redeploy.";
  }
  if (["28P01", "3D000", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"].includes(error?.code)) {
    return "The gateway cannot connect to the configured database. Check DATABASE_URL, database credentials, and network access.";
  }
  return "Admin database request failed. Check DATABASE_URL and apply the current schema.sql.";
}

export function createAdminHandler({ db = database, readiness = inferenceStatus } = {}) {
return async function admin(req) {
  const auth = authorizeAdmin(req);
  if (auth !== 200) return json({ error: authFailure(auth) }, auth);
  if (!["GET", "POST"].includes(req.method)) return json({ error: "Method not allowed" }, 405);
  try {
    if (req.method === "GET" && new URL(req.url).searchParams.get('view') === 'readiness') {
      return json({ inference: await readiness(), databaseConfigured: Boolean(process.env.DATABASE_URL) });
    }
    if (req.method === "GET") {
      const url = new URL(req.url);
      const view = url.searchParams.get('view');
      let options;
      if (view === 'customer') {
        if (!uuid.test(url.searchParams.get('id') || '')) return json({ error: 'Invalid customer ID' }, 400);
      } else {
        if (view && view !== 'customers') return json({ error: 'Invalid admin view' }, 400);
        try { options = listOptions(url); } catch { return json({ error: 'Invalid customer search or pagination' }, 400); }
      }
      const store = db();
      await store.query('SELECT credit_policy,provider_cost_upper_nanodollars FROM token_events LIMIT 0');
      await store.query('SELECT estimated_credits,heartbeat_at FROM token_reservations LIMIT 0');
      if (view === 'customer') {
        const id = url.searchParams.get('id');
        const customer = await store.query(balances + `SELECT ${customerColumns} FROM balances WHERE id=$1`, [id]);
        if (!customer.rows[0]) return json({ error: 'Customer not found' }, 404);
        const events = await store.query('SELECT id,kind,token_delta::text,created_at FROM token_events WHERE customer_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50', [id]);
        const audit = await store.query('SELECT id,action,reason,token_amount::text,created_at FROM admin_audit WHERE customer_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50', [id]);
        const reservations = await store.query("SELECT id,status,reserved_tokens::text,estimated_credits::text,created_at,heartbeat_at FROM token_reservations WHERE customer_id=$1 AND status IN ('held','review') ORDER BY created_at DESC,id DESC LIMIT 50", [id]);
        return json({ customer: customer.rows[0], events: events.rows, audit: audit.rows, reservations: reservations.rows, historyLimit: 50 });
      }
      const { search,state,page,limit,offset,order } = options;
      const summary = await store.query(balances + `SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE NOT disabled)::int AS active,COUNT(*) FILTER (WHERE disabled)::int AS revoked,
        COALESCE(SUM(granted),0)::text AS granted,COALESCE(SUM(used),0)::text AS used,
        COALESCE(SUM(remaining),0)::text AS remaining,COALESCE(SUM(reserved),0)::text AS reserved
        FROM balances ${customerFilter}`, [search,state]);
      const result = await store.query(balances + `SELECT ${customerColumns} FROM balances ${customerFilter} ORDER BY ${order} LIMIT $3 OFFSET $4`, [search,state,limit,offset]);
      return json({ customers: result.rows, page, limit, total: summary.rows[0].total, summary: summary.rows[0], inferenceMeteringEnabled: true, inference: await readiness() });
    }
    // Bounded body; never log its content, Authorization, or newly issued keys.
    const text = await req.text();
    if (Buffer.byteLength(text) > 4096) return json({ error: "Request too large" }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (!body || !["create", "grant", "revoke"].includes(body.action)) return json({ error: "Invalid action" }, 400);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3 || reason.length > 300) return json({ error: "Provide a reason (3–300 characters)" }, 400);
    let amount;
    if (body.action !== "revoke") {
      try { amount = positiveTokens(body.tokens); } catch { return json({ error: "Invalid token amount" }, 400); }
      if (amount > 1_000_000_000) return json({ error: "Maximum 1 billion tokens per operation" }, 400);
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (body.action === "create" && (!name || name.length > 100)) return json({ error: "Name must be 1–100 characters" }, 400);
    if (body.action !== "create" && !uuid.test(body.customerId ?? "")) return json({ error: "Invalid customer ID" }, 400);
    // Client-generated operation ID prevents a network retry from granting twice.
    if (!uuid.test(body.operationId ?? "")) return json({ error: "A unique operationId is required" }, 400);

    const client = await db().connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query(`
        INSERT INTO admin_audit (id,action,reason,token_amount)
        VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [body.operationId, body.action, reason, amount ?? null]);
      if (!claimed.rowCount) {
        await client.query("ROLLBACK");
        return json({ error: "Operation already submitted. Refresh balances before retrying. New keys cannot be recovered." }, 409);
      }
      let customerId = body.customerId;
      let key;
      if (body.action === "create") {
        customerId = randomUUID();
        key = mintKey();
        await client.query("INSERT INTO customers (id,name,key_hash) VALUES ($1,$2,$3)", [customerId, name, keyHash(key)]);
      } else {
        const found = await client.query("SELECT disabled FROM customers WHERE id=$1 FOR UPDATE", [customerId]);
        if (!found.rowCount || (body.action === "grant" && found.rows[0].disabled)) {
          await client.query("ROLLBACK");
          return json({ error: "Customer not found or disabled" }, 404);
        }
      }
      if (body.action === "revoke") {
        await client.query("UPDATE customers SET disabled=TRUE WHERE id=$1", [customerId]);
      } else {
        await client.query("INSERT INTO token_events (id,customer_id,kind,token_delta) VALUES ($1,$2,'grant',$3)",
          [randomUUID(), customerId, amount]);
      }
      await client.query("UPDATE admin_audit SET customer_id=$1 WHERE id=$2", [customerId, body.operationId]);
      await client.query("COMMIT");
      return json({ ok: true, customerId, ...(key ? { key, note: "Shown once. Deliver privately; not stored in plaintext." } : {}) });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } catch (error) {
    // Keep logs useful while excluding raw messages and request/customer data.
    console.error("Admin database operation failed", { code: error?.code ?? "unknown" });
    return json({ error: databaseFailure(error) }, 503);
  }
}
}
export default createAdminHandler();
export const config = { path: "/api/admin" };
