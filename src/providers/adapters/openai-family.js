import { requestJson, requestStream, authHeaders } from './base.js';

export class OpenAIFamilyProvider {
  constructor({ id, name, baseUrl, apiKey = '', defaultModel = '', capabilities = [], networkPolicy = {} }) {
    this.id = id; this.name = name ?? id; this.baseUrl = String(baseUrl).replace(/\/$/, ''); this.apiKey = apiKey; this.defaultModel = defaultModel; this.networkPolicy = networkPolicy;
    this.capabilities = { streaming: true, functionCalling: true, chatCompletions: true, models: true, ...Object.fromEntries(capabilities.map(x => [x, true])) };
  }
  headers() { return authHeaders(this.apiKey); }
  async listModels() { return requestJson(`${this.baseUrl}/models`, 'GET', undefined, this.headers(), 30000, this.networkPolicy); }
  payload(input = {}, model) { const payload = { ...input, model }; delete payload.provider; delete payload.timeoutMs; return payload; }
  requestTimeout(input={}) { const configured=Number(this.networkPolicy.requestTimeoutMs)||30000; const requested=Number(input.timeoutMs); return Math.max(1000,Math.min(600000,Number.isFinite(requested)&&requested>0?requested:configured)); }
  async chatCompletions(input = {}) { const model = input.model ?? this.defaultModel; if (!model) throw new Error('provider_model_required'); return requestJson(`${this.baseUrl}/chat/completions`, 'POST', this.payload(input, model), this.headers(), this.requestTimeout(input), this.networkPolicy); }
  toCanonical(raw) { return raw; }
  streamChunk(raw) { return raw; }
  async streamChat(input = {}, onChunk) { const model = input.model ?? this.defaultModel; if (!model) throw new Error('provider_model_required'); return requestStream(`${this.baseUrl}/chat/completions`, this.payload({...input, stream:true}, model), this.headers(), {timeoutMs:this.requestTimeout(input), onEvent:onChunk, networkPolicy:this.networkPolicy}); }
}
