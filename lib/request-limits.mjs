import { QuotaError } from './quota.mjs';

export const REQUEST_LIMITS = Object.freeze({ rawBytes: 512000, canonicalBytes: 120000,
  inputTokens: 500000, outputTokens: 4096, messages: 256, tools: 128, nodes: 12000, depth: 32 });
const invalid = (message, status = 400) => { throw new QuotaError(message, status); };
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (x) => { if (typeof x !== 'string') invalid('Text must be a string'); return x; };
const name = (x) => { if (typeof x !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(x)) invalid('Invalid client tool name or ID'); return x; };

function inspectJson(value, state, depth = 0) {
  if (++state.nodes > REQUEST_LIMITS.nodes || depth > REQUEST_LIMITS.depth) invalid('Request structure is too complex', 413);
  if (typeof value === 'string' && /<\/?image>|<｜deepseek_image｜>/.test(value)) invalid('Image placeholders are not supported in text requests');
  if (Array.isArray(value)) for (const child of value) inspectJson(child, state, depth + 1);
  else if (object(value)) for (const [key, child] of Object.entries(value)) {
    inspectJson(key, state, depth + 1); inspectJson(child, state, depth + 1);
  }
}

export function prepareRequest(body) {
  if (!object(body) || !Array.isArray(body.messages) || !body.messages.length) invalid('Messages required');
  if (body.messages.length > REQUEST_LIMITS.messages) invalid('Too many messages; compact the conversation', 413);
  if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1) invalid('A positive max_tokens is required');
  // The server owns this ceiling: larger client defaults cannot bypass it.
  const outputTokens = Math.min(body.max_tokens, REQUEST_LIMITS.outputTokens);
  let wrappers = body.messages.length;
  function block(b, role, nested = false) {
    if (!object(b)) invalid('Invalid content block');
    wrappers++;
    if (b.type === 'text') return { type: 'text', text: text(b.text) };
    if (!nested && role === 'assistant' && b.type === 'tool_use') {
      if (!object(b.input)) invalid('Client tool input must be an object');
      wrappers += Object.keys(b.input).length;
      return { type: 'tool_use', id: name(b.id), name: name(b.name), input: b.input };
    }
    if (!nested && role === 'user' && b.type === 'tool_result') {
      const result = { type: 'tool_result', tool_use_id: name(b.tool_use_id) };
      if (typeof b.content === 'string') result.content = b.content;
      else if (Array.isArray(b.content)) result.content = b.content.map(c => block(c, role, true));
      else if (b.content === undefined) result.content = '';
      else invalid('Tool results must contain text');
      if (typeof b.is_error === 'boolean') result.is_error = b.is_error;
      return result;
    }
    invalid('This gateway accepts text and client tools only. Images, documents, server tools and stored reasoning are disabled.', 400);
  }
  function systemBlocks(value) {
    if (typeof value === 'string') { wrappers++; return [{ type: 'text', text: value }]; }
    if (!Array.isArray(value)) invalid('System prompt must contain text');
    return value.map(b => {
      if (!object(b) || b.type !== 'text') invalid('Only text system blocks are supported');
      wrappers++; return { type: 'text', text: text(b.text) };
    });
  }
  const system = body.system === undefined ? [] : systemBlocks(body.system);
  const messages = [];
  for (const m of body.messages) {
    if (!object(m) || !['user', 'assistant', 'system'].includes(m.role)) invalid('Invalid message role');
    // Claude Code 2.1.329 appends system-role context messages even to the first
    // turn. Anthropic-format providers expect these instructions at API level,
    // not in the user/assistant history. Retain text and order in the system list.
    if (m.role === 'system') { system.push(...systemBlocks(m.content)); continue; }
    messages.push({ role: m.role, content: typeof m.content === 'string' ? m.content :
      Array.isArray(m.content) ? m.content.map(b => block(b, m.role)) : invalid('Message content must be text or blocks') });
  }
  if (!messages.length) invalid('At least one user or assistant message is required');
  const upstream = { model: 'deepseek-flash', stream: false, thinking: { type: 'disabled' }, max_tokens: outputTokens, messages };
  if (body.system !== undefined) {
    upstream.system = system;
  }
  else if (system.length) upstream.system = system;
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools) || body.tools.length > REQUEST_LIMITS.tools) invalid('Invalid client tool list');
    wrappers += body.tools.length;
    upstream.tools = body.tools.map(t => {
      if (!object(t) || t.type || !object(t.input_schema)) invalid('Only client-defined tools are supported; no provider server tools');
      const tool = { name: name(t.name), input_schema: t.input_schema };
      if (t.description !== undefined) tool.description = text(t.description);
      return tool;
    });
  }
  if (body.tool_choice !== undefined) {
    if (!object(body.tool_choice) || !['auto', 'none', 'any', 'tool'].includes(body.tool_choice.type)) invalid('Invalid tool choice');
    upstream.tool_choice = { type: body.tool_choice.type };
    if (body.tool_choice.type === 'tool') upstream.tool_choice.name = name(body.tool_choice.name);
  }
  inspectJson(upstream, { nodes: 0 });
  const serialized = JSON.stringify(upstream);
  const bytes = Buffer.byteLength(serialized);
  if (bytes > REQUEST_LIMITS.canonicalBytes) invalid('Request is too large. Compact the conversation or reduce tool results.', 413);
  // Official Flash-1017 tokenizer: no normalization, no prefix-space insertion,
  // byte-level BPE. Tokens cannot outnumber encoded UTF-8 bytes. The reference
  // encoder serializes schemas once, adds DSML wrappers to tool parameters, and
  // joins blocks. 4x JSON bytes covers escaping/spacing/adaptation; 256 bytes per
  // wrapper + 8192 fixed bytes cover DSML, turn markers and the tool preamble.
  // This is an upper bound for the allowlisted text protocol, NOT cl100k sizing.
  // Sources and regression references are recorded in REQUEST-LIMITS.md.
  const inputTokens = bytes * 4 + wrappers * 256 + 8192;
  if (inputTokens > REQUEST_LIMITS.inputTokens) invalid('Request exceeds the enforced context budget. Compact the conversation.', 413);
  return { upstream, serialized, inputTokens, outputTokens };
}

export async function readRequestBody(req) {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > REQUEST_LIMITS.rawBytes) { await reader.cancel(); invalid('Request body too large', 413); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}
