import assert from "node:assert/strict";
import { test } from "node:test";
import countTokens, {createCountTokensHandler} from "../netlify/functions/count-tokens.mjs";
import {prepareRequest} from '../lib/request-limits.mjs';
import {countInput} from '../lib/exact-input.mjs';
import { countMessageTokens } from "../lib/token-count.mjs";

test('Desktop tool output above the old byte limits is accepted and counted consistently',async()=>{
  const body={max_tokens:100,messages:[{role:'user',content:'Inspect Blender'},
    {role:'assistant',content:[{type:'tool_use',id:'call_1',name:'mcp__blender__get_scene_info',input:{}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:'call_1',content:'Scene object mesh details. '.repeat(24000)}]}],
    tools:[{name:'mcp__blender__get_scene_info',description:'Inspect the current Blender scene',input_schema:{type:'object'}}]};
  assert.ok(Buffer.byteLength(JSON.stringify(body))>512000);
  const prepared=prepareRequest(body);
  assert.equal(prepared.upstream.messages[2].content[0].content,body.messages[2].content[0].content);
  assert.equal(prepared.upstream.tools[0].name,'mcp__blender__get_scene_info');
  assert.match(prepared.upstream.system.at(-1).text,/tool discovery/);
  assert.ok(prepared.inputTokens>500000,'Old byte-as-token gate would reject this');
  assert.ok(countInput(prepared.upstream).inputTokens<500000);
  const handler=createCountTokensHandler({getDatabase:()=>({query:async()=>({rowCount:1})})});
  const response=await handler(new Request('https://gateway.test/v1/messages/count_tokens',{
    method:'POST',headers:{Authorization:`Bearer sk-gw-${'a'.repeat(64)}`},body:JSON.stringify(body)}));
  assert.equal(response.status,200);
  assert.equal((await response.json()).input_tokens,countInput(prepareRequest({...body,max_tokens:1}).upstream).inputTokens);
});

test("count_tokens uses cl100k_base for known text and includes framing", () => {
  assert.equal(countMessageTokens({ messages: [{ role: "user", content: "hello world" }] }), 26);
  assert.ok(countMessageTokens({ messages: [{ role: "user", content: "Hello 世界 👋" }] }) > 0);
});

test("hosted count_tokens requires a valid customer key and HTTPS", async () => {
  const noKey = await countTokens(new Request("https://apily.netlify.app/v1/messages/count_tokens", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [] }),
  }));
  assert.equal(noKey.status, 401);

  const http = await countTokens(new Request("http://apily.netlify.app/v1/messages/count_tokens", {
    method: "POST", headers: { Authorization: `Bearer sk-gw-${"a".repeat(64)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  }));
  assert.equal(http.status, 400);
});
