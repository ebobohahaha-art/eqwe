import { Tokenizer } from '@huggingface/tokenizers';
import definition from './assets/deepseek-flash-1017-tokenizer.json' with { type: 'json' };
import format from './assets/prompt-format.json' with { type: 'json' };
let tokenizer;

// JSON with Python-style separator spacing, as used by the official encoder.
function schemaJson(value) {
  const raw=JSON.stringify(value);let result='',quoted=false,escaped=false;
  for(const char of raw){
    result+=char;
    if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;}
    else if(char==='"')quoted=true;else if(char===','||char===':')result+=' ';
  }
  return result;
}
const textBlocks=content=>typeof content==='string'?content:content.map(b=>b.text).join('\n\n');

// Port of the supported, non-thinking text/client-tool subset of DeepSeek's
// Flash-1017 reference encoder. Unsupported media/reasoning is rejected earlier.
export function renderInput(upstream){
  const messages=[];
  if(upstream.system?.length||upstream.tools?.length)messages.push({role:'system',text:upstream.system?textBlocks(upstream.system):'',tools:upstream.tools});
  for(const m of upstream.messages){
    if(m.role==='user'){
      const blocks=typeof m.content==='string'?[{type:'text',text:m.content}]:m.content;
      if(messages.at(-1)?.role==='user')messages.at(-1).blocks.push(...blocks);
      else messages.push({role:'user',blocks:[...blocks]});
    }else messages.push({role:'assistant',text:typeof m.content==='string'?m.content:m.content.filter(b=>b.type==='text').map(b=>b.text).join('\n\n'),calls:typeof m.content==='string'?[]:m.content.filter(b=>b.type==='tool_use')});
  }
  let prompt='<｜begin▁of▁sentence｜>';
  for(let index=0;index<messages.length;index++){
    const m=messages[index];
    if(m.role==='system'){
      prompt+='<｜System｜>'+m.text;
      if(m.tools?.length){
        const schemas=m.tools.map(t=>schemaJson({name:t.name,description:t.description??'',parameters:t.input_schema})).join('\n');
        prompt+='\n\n'+format.toolsTemplate.replace('__TOOL_SCHEMAS__',()=>schemas);
      }
    }else if(m.role==='user'){
      prompt+='<｜User｜>'+m.blocks.map(b=>b.type==='text'?b.text:'<tool_result>'+textBlocks(b.content)+'</tool_result>').join('\n\n');
    }else{
      prompt+=m.text;
      if(m.calls?.length){
        const calls=m.calls.map(c=>{
          const args=Object.entries(c.input).map(([key,value])=>`<｜DSML｜ parameter name="${key}" string="${typeof value==='string'}">${typeof value==='string'?value:schemaJson(value)}</｜DSML｜ parameter>`).join('\n');
          return `<｜DSML｜ invoke name="${c.name}">\n${args}\n</｜DSML｜ invoke>`;
        }).join('\n');
        prompt+='\n\n<｜DSML｜ calls>\n'+calls+'\n</｜DSML｜ calls>';
      }
      prompt+='<｜end▁of▁sentence｜>';
    }
    if(m.role==='user'&&(index===messages.length-1||messages[index+1].role==='assistant'))prompt+='<｜Assistant｜></think>';
  }
  return prompt;
}

export function countInput(upstream){
  tokenizer??=new Tokenizer(definition,{});
  const tokens=tokenizer.encode(renderInput(upstream),{add_special_tokens:false}).ids.length;
  // Protocol adaptation/number formatting guard, not a multiplier of prompt size.
  const guard=2048+64*(upstream.messages.length+(upstream.tools?.length??0));
  return {tokens,guard,inputTokens:tokens+guard};
}
