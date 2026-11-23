export const balances = `WITH grants AS (
  SELECT customer_id,
    SUM(CASE WHEN kind='grant' THEN token_delta ELSE 0 END) AS granted,
    -SUM(CASE WHEN kind='usage' THEN token_delta ELSE 0 END) AS used,
    SUM(token_delta) AS balance FROM token_events GROUP BY customer_id
), holds AS (
  SELECT customer_id,SUM(reserved_tokens) AS reserved,SUM(estimated_credits) AS pending
  FROM token_reservations WHERE status IN ('held','review') GROUP BY customer_id
), balances AS (
  SELECT c.id,c.name,c.disabled,c.created_at,COALESCE(g.granted,0) AS granted,
    COALESCE(g.used,0) AS used,COALESCE(h.reserved,0) AS reserved,
    COALESCE(h.pending,0) AS pending,COALESCE(g.balance,0)-COALESCE(h.reserved,0) AS remaining
  FROM customers c LEFT JOIN grants g ON g.customer_id=c.id LEFT JOIN holds h ON h.customer_id=c.id
) `;
export const customerColumns = 'id,name,disabled,created_at,granted::text,used::text,reserved::text,pending::text,remaining::text';
export const customerFilter = `WHERE ($1='' OR position(lower($1) in lower(name))>0 OR position(lower($1) in id::text)>0)
  AND ($2='all' OR ($2='active' AND NOT disabled) OR ($2='revoked' AND disabled)
    OR ($2='depleted' AND NOT disabled AND remaining<=0))`;
export function listOptions(url) {
  const search = (url.searchParams.get('search') || '').trim();
  const state = url.searchParams.get('status') || 'all';
  const sort = url.searchParams.get('sort') || 'newest';
  const page = Number(url.searchParams.get('page') || 1);
  const limit = Number(url.searchParams.get('limit') || 25);
  const order = { newest: 'created_at DESC,id DESC', oldest: 'created_at ASC,id ASC',
    name: 'lower(name) ASC,id ASC', balance_high: 'remaining DESC,id ASC', balance_low: 'remaining ASC,id ASC' }[sort];
  if (search.length>100 || !['all','active','revoked','depleted'].includes(state) || typeof order!=='string' ||
      !Number.isInteger(page) || page<1 || page>100000 || !Number.isInteger(limit) || limit<1 || limit>100) {
    throw new Error('Invalid customer search or pagination');
  }
  return { search,state,sort,page,limit,offset:(page-1)*limit,order };
}
