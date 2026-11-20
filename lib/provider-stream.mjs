export const encodeEvent=(type,data)=>new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify({...data,type})}\n\n`);

async function* events(body){
  const reader=body.getReader(),decoder=new TextDecoder();let buffer='',ended=false;
  function parse(frame){
    const lines=frame.split('\n'),data=lines.filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!data)return null;
    const payload=JSON.parse(data);
    const type=lines.find(l=>l.startsWith('event:'))?.slice(6).trim()||payload.type;
    if(payload.error||type==='error')throw new Error('Provider stream failed');
    return {type,data:payload};
  }
  try{
    while(true){
      const {value,done}=await reader.read();
      buffer+=done?decoder.decode():decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');
      if(buffer.length>1000000)throw new Error('Provider event is too large');
      let boundary;
      while((boundary=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const parsed=parse(frame);if(parsed)yield parsed;}
      if(done){if(buffer.trim()){const parsed=parse(buffer);if(parsed)yield parsed;}ended=true;break;}
    }
  }finally{if(!ended)await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export async function consumeProviderStream(response,{alias,onEvent=()=>{},progress}){
  let message,finalUsage,stop=false;const blocks=[],argumentsByIndex=new Map();
  for await(const {type,data} of events(response.body)){
    if(type==='message_start'){
      if(message)throw new Error('Duplicate provider message');
      message={...data.message,content:[]};if(alias)message.model=alias;
      progress.input=message.usage?.input_tokens??progress.input;
      await onEvent(type,{...data,message});
    }else if(type==='content_block_start'){
      const b=data.content_block;
      if(!message||data.index!==blocks.length||!['text','tool_use'].includes(b?.type)||b.type==='text'&&typeof b.text!=='string')throw new Error('Unsupported provider block');
      blocks[data.index]={...b};
      if(b.type==='tool_use'){argumentsByIndex.set(data.index,'');progress.outputBytes+=256;}
      await onEvent(type,data);
    }else if(type==='content_block_delta'){
      const b=blocks[data.index];if(!b)throw new Error('Missing provider block');
      if(data.delta?.type==='text_delta'&&b.type==='text'){b.text+=data.delta.text;progress.outputBytes+=Buffer.byteLength(data.delta.text);}
      else if(data.delta?.type==='input_json_delta'&&b.type==='tool_use'){argumentsByIndex.set(data.index,argumentsByIndex.get(data.index)+data.delta.partial_json);progress.outputBytes+=Buffer.byteLength(data.delta.partial_json);}
      else throw new Error('Unsupported provider delta');
      if(progress.outputBytes>2000000)throw new Error('Provider response exceeds limit');
      await onEvent(type,data);
    }else if(type==='content_block_stop'){
      if(argumentsByIndex.has(data.index)){const raw=argumentsByIndex.get(data.index);if(raw)blocks[data.index].input=JSON.parse(raw);}
      await onEvent(type,data);
    }else if(type==='message_delta'){
      if(!message)throw new Error('Provider message missing');
      Object.assign(message,data.delta);finalUsage=data.usage;
      // Final cumulative usage replaces initial estimates; never add snapshots.
    }else if(type==='message_stop'){stop=true;break;}
    else if(type==='ping')await onEvent(type,data);
    else throw new Error('Unexpected provider stream event');
  }
  if(!message||!stop||!finalUsage)throw new Error('Incomplete provider stream');
  message.content=blocks;message.usage=finalUsage;
  return message;
}
