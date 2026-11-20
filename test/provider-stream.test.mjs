import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consumeProviderStream} from '../lib/provider-stream.mjs';
const frame=(type,data)=>`event: ${type}\r\ndata: ${JSON.stringify({...data,type})}\r\n\r\n`;
test('Fragmented UTF-8 SSE and tool JSON preserve content and replace cumulative usage snapshots',async()=>{
  const raw=frame('message_start',{message:{type:'message',role:'assistant',model:'provider',usage:{input_tokens:999,output_tokens:0}}})+
    frame('content_block_start',{index:0,content_block:{type:'text',text:''}})+frame('content_block_delta',{index:0,delta:{type:'text_delta',text:'你好🙂'}})+frame('content_block_stop',{index:0})+
    frame('content_block_start',{index:1,content_block:{type:'tool_use',id:'call_1',name:'read',input:{}}})+
    frame('content_block_delta',{index:1,delta:{type:'input_json_delta',partial_json:'{"path":'}})+frame('content_block_delta',{index:1,delta:{type:'input_json_delta',partial_json:'"test.txt"}'}})+frame('content_block_stop',{index:1})+
    frame('message_delta',{delta:{stop_reason:'tool_use'},usage:{input_tokens:10,output_tokens:5,cache_read_input_tokens:20}})+frame('message_stop',{});
  const bytes=new TextEncoder().encode(raw),response=new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=2)controller.enqueue(bytes.slice(i,i+2));controller.close();}}));
  const message=await consumeProviderStream(response,{alias:'apiduck-fast',progress:{input:0,outputBytes:0}});
  assert.equal(message.model,'apiduck-fast');assert.equal(message.content[0].text,'你好🙂');
  assert.deepEqual(message.content[1].input,{path:'test.txt'});assert.equal(message.usage.input_tokens,10);
});
test('Incomplete or error streams never produce a final billable message',async()=>{
  for(const data of [frame('error',{error:{message:'provider failed'}}),frame('message_start',{message:{type:'message',usage:{input_tokens:1,output_tokens:0}}})]){
    await assert.rejects(consumeProviderStream(new Response(data),{progress:{input:0,outputBytes:0}}));
  }
});
