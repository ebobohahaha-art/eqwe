import assert from "node:assert/strict";
import { test } from "node:test";
import { measuredUsage, reserveTokens, settleTokens } from "../lib/quota.mjs";
import messages from "../netlify/functions/messages.mjs";
test("Provider usage includes cache tokens exactly once", () => {
  assert.equal(measuredUsage({ input_tokens:10,output_tokens:5,cache_read_input_tokens:20,cache_creation_input_tokens:3 }),38);
  for (const usage of [null, {}, {input_tokens:-1,output_tokens:0}, {input_tokens:1,output_tokens:NaN}]) {
    assert.throws(() => measuredUsage(usage));
  }
});
function fakeDb(handler) {
  const queries = [];
  const client = { query: async (sql, args) => {
    queries.push(sql);
    return handler(sql, args) ?? { rows: [], rowCount: 0 };
  }, release() {} };
  return { db: { connect: async () => client }, queries };
}

test('Missing cost-credit migration stops before reservation and rolls back',async()=>{
  const {db,queries}=fakeDb(sql=>{
    if(sql.includes('SELECT credit_policy')) { const error=new Error('missing column');error.code='42703';throw error; }
  });
  await assert.rejects(reserveTokens(db,'hash',100),/schema.sql/);
  assert.ok(queries.includes('ROLLBACK'));
  assert.ok(!queries.some(q=>q.includes('INSERT')));
});
test("Zero allowance rolls back without making a reservation", async () => {
  const {db,queries} = fakeDb((sql) => {
    if(sql.includes("key_hash")) return {rows:[{id:"user",disabled:false}]};
    if(sql.includes("AS balance")) return {rows:[{balance:"0"}]};
  });
  await assert.rejects(reserveTokens(db,"hash",100), /Insufficient/);
  assert.ok(queries.includes("ROLLBACK"));
  assert.ok(!queries.some((q)=>q.includes("INSERT")));
});
test("Overlapping requests use only unreserved balance and retain unresolved holds", async () => {
  const holds=[{id:'pending',reserved_tokens:'700'}];let inserts=0;
  const {db} = fakeDb((sql,args) => {
    if(sql.includes("key_hash")) return {rows:[{id:"user",disabled:false}]};
    if(sql.includes('SELECT id,reserved_tokens FROM token_reservations'))return {rowCount:holds.length,rows:holds};
    if(sql.includes('AS balance'))return {rows:[{balance:'1000'}]};
    if(sql.includes('INSERT INTO token_reservations')){inserts++;holds.push({id:args[0],reserved_tokens:String(args[2])});}
  });
  const first=await reserveTokens(db,'hash',200);
  assert.equal(first.remaining,'100');
  await assert.rejects(reserveTokens(db,'hash',101),/Insufficient/);
  assert.equal(inserts,1);
  const last=await reserveTokens(db,'hash',100);
  assert.equal(last.remaining,'0');
  await assert.rejects(reserveTokens(db,'hash',1),/Insufficient/);
  assert.equal(holds[0].reserved_tokens,'700');
});
test("Settlement refuses duplicate debit", async () => {
  const {db,queries} = fakeDb((sql) => {
    if(sql.includes("SELECT status")) return {rows:[{status:"settled",reserved_tokens:"100"}]};
  });
  await assert.rejects(settleTokens(db,{id:"req",customerId:"user"},10), /twice/);
  assert.ok(!queries.some((q)=>q.includes("INSERT")));
});
test("Hosted endpoint refuses unauthenticated calls before touching provider/database", async () => {
  const response = await messages(new Request("https://example.test/v1/messages",{method:"POST"}));
  assert.equal(response.status,401);
});
