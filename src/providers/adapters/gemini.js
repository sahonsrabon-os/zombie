import { requestJson, requestStream } from './base.js';

function parseToolArgs(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return {}; }
}

function geminiContents(messages=[]) {
  return messages.filter(m => m.role !== 'system' && m.role !== 'developer').map(m => {
    if (m.role === 'tool') {
      return { role: 'user', parts: [{ functionResponse: { name: String(m.name ?? 'tool'), response: parseToolArgs(m.content) } }] };
    }
    if (m.role === 'assistant') {
      const parts = [];
      if (typeof m.content === 'string' && m.content) parts.push({text:m.content});
      for (const call of m.tool_calls ?? []) {
        const fn = call?.function ?? {};
        parts.push({functionCall:{name:fn.name, args:parseToolArgs(fn.arguments), ...(call.id ? {id:String(call.id)} : {})}});
      }
      return {role:'model',parts:parts.length ? parts : [{text:''}]};
    }
    return { role: 'user', parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '') }] };
  });
}
function geminiSystemInstruction(messages=[]) {
  const text = messages.filter(m => m?.role === 'system' || m?.role === 'developer').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')).filter(Boolean).join('\n\n');
  return text ? {parts:[{text}]} : undefined;
}

function geminiTools(tools=[]) {
  const declarations = tools.map(t => t?.function ?? t).filter(Boolean).map(f => ({name:f.name, description:f.description ?? '', parameters:f.parameters ?? {type:'object',properties:{}}}));
  return declarations.length ? [{functionDeclarations:declarations}] : undefined;
}
export class GeminiProvider {
  constructor({id='gemini', baseUrl='https://generativelanguage.googleapis.com/v1beta', apiKey='', defaultModel='', networkPolicy={}}={}) { this.id=id; this.name='Gemini'; this.baseUrl=baseUrl.replace(/\/$/,''); this.apiKey=apiKey; this.defaultModel=defaultModel; this.networkPolicy=networkPolicy; this.capabilities={streaming:true,functionCalling:true,chatCompletions:false,generateContent:true}; }
  headers(){ return {'content-type':'application/json','x-goog-api-key':this.apiKey}; }
  async listModels(){
    const raw = await requestJson(`${this.baseUrl}/models`, 'GET', undefined, {'x-goog-api-key':this.apiKey}, 30000, this.networkPolicy);
    // Gemini returns resource names such as `models/gemini-2.5-flash`; the generateContent path expects the model ID segment only.
    return {...raw, data:(Array.isArray(raw?.models) ? raw.models : []).map(item => ({...item, id:String(item?.name ?? item?.id ?? '').replace(/^models\//, '')})).filter(item => item.id)};
  }
  payload(input={}) {
    const generationConfig={};
    const aliases={temperature:'temperature',topP:'topP',top_p:'topP',topK:'topK',maxOutputTokens:'maxOutputTokens',max_tokens:'maxOutputTokens',max_completion_tokens:'maxOutputTokens'};
    for(const [source,target] of Object.entries(aliases)) if(input[source] !== undefined && generationConfig[target] === undefined) generationConfig[target]=input[source];
    const tools=geminiTools(input.tools);
    const toolConfig = input.tool_choice === 'none' ? {functionCallingConfig:{mode:'NONE'}} : input.tool_choice === 'required' ? {functionCallingConfig:{mode:'ANY'}} : (input.tool_choice?.function?.name ? {functionCallingConfig:{mode:'ANY',allowedFunctionNames:[input.tool_choice.function.name]}} : undefined);
    return {contents:geminiContents(input.messages), ...(geminiSystemInstruction(input.messages) ? {systemInstruction:geminiSystemInstruction(input.messages)} : {}), ...(tools ? {tools} : {}), ...(tools && toolConfig ? {toolConfig} : {}), ...(Object.keys(generationConfig).length ? {generationConfig} : {})};
  }
  toCanonical(raw) { const candidates=raw?.candidates ?? []; const toolCalls=[]; const textParts=[]; for(const c of candidates){ for(const part of c?.content?.parts ?? []) { if(part?.text) textParts.push(part.text); if(part?.functionCall) toolCalls.push({id:part.functionCall.id ?? `call_${toolCalls.length+1}`,type:'function',function:{name:part.functionCall.name,arguments:JSON.stringify(part.functionCall.args ?? {})}}); } } return {id:raw.responseId ?? `gemini_${Date.now()}`,object:'chat.completion',model:raw.model ?? this.defaultModel,choices:[{index:0,message:{role:'assistant',content:textParts.join('') || null,...(toolCalls.length?{tool_calls:toolCalls}:{})},finish_reason:candidates[0]?.finishReason?.toLowerCase() ?? null}],usage:raw.usageMetadata ? {prompt_tokens:raw.usageMetadata.promptTokenCount ?? 0,completion_tokens:raw.usageMetadata.candidatesTokenCount ?? 0,total_tokens:raw.usageMetadata.totalTokenCount ?? 0} : undefined}; }
  streamChunk(raw) {
    const candidates = raw?.candidates ?? [];
    const parts = candidates[0]?.content?.parts ?? [];
    const content = parts.filter(p => typeof p?.text === 'string').map(p => p.text).join('');
    const toolCalls = parts.filter(p => p?.functionCall).map((p, index) => ({
      index,
      id: p.functionCall.id ?? `call_${index + 1}`,
      type: 'function',
      function: {name:p.functionCall.name, arguments:JSON.stringify(p.functionCall.args ?? {})}
    }));
    return {id:raw.responseId ?? `gemini_${Date.now()}`,object:'chat.completion.chunk',model:raw.model ?? this.defaultModel,choices:[{index:0,delta:{...(content ? {content}:{})},...(toolCalls.length ? {delta:{...(content ? {content}:{}),tool_calls:toolCalls}} : {}),finish_reason:candidates[0]?.finishReason?.toLowerCase() ?? null}]};
  }
  requestTimeout(input={}) { const configured=Number(this.networkPolicy.requestTimeoutMs)||30000;const requested=Number(input.timeoutMs);return Math.max(1000,Math.min(600000,Number.isFinite(requested)&&requested>0?requested:configured)); }
  async chatCompletions(input={}) { const model=input.model ?? this.defaultModel; if(!model) throw new Error('provider_model_required'); return requestJson(`${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, 'POST', this.payload(input), this.headers(), this.requestTimeout(input), this.networkPolicy); }
  async streamChat(input={}, onChunk){ const model=input.model ?? this.defaultModel; if(!model) throw new Error('provider_model_required'); return requestStream(`${this.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, this.payload(input), this.headers(), {onEvent:onChunk, timeoutMs:this.requestTimeout(input), networkPolicy:this.networkPolicy}); }
}
