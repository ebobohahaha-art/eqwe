import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareRequest} from '../lib/request-limits.mjs';
import {countInput} from '../lib/exact-input.mjs';
import {createHash} from 'node:crypto';
test('Model tokenizer asset is pinned to the reviewed official definition',()=>{
  const bytes=readFileSync(new URL('../lib/assets/deepseek-flash-1017-tokenizer.json',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'c90dfa01249db1be4245780a052ede752e1361c612ac6d08e2bdada7d599476b');
});
test('Official tokenizer counts reference text/tool cases without byte inflation',()=>{
  const reference=JSON.parse(readFileSync(new URL('./fixtures/request-bound-reference.json',import.meta.url),'utf8'));
  for(const row of reference.cases){
    const prepared=prepareRequest(row.body);
    // Reference fixtures predate the extra tool workflow instructions.
    if(prepared.upstream.tools?.length)prepared.upstream.system.pop();
    const count=countInput(prepared.upstream);
    assert.equal(count.tokens,row.referenceInputTokens);
    assert.ok(count.inputTokens>=row.referenceInputTokens);
    assert.ok(count.inputTokens<=prepared.inputTokens);
  }
});
