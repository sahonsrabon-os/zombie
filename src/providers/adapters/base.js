import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { assertSafeOutboundUrl } from '../../network/outbound-policy.js';
import { protectOutbound } from '../../network/circuit-breaker.js';

async function prepareTarget(urlString, networkPolicy = {}) {
  return assertSafeOutboundUrl(urlString, {
    protocols: ['https:'],
    allowPlaintextHttp: networkPolicy.allowPlaintextHttp === true,
    allowHosts: networkPolicy.allowHosts ?? [],
    allowPrivateNetwork: networkPolicy.allowPrivateNetwork === true,
    allowPrivateHosts: networkPolicy.allowPrivateHosts ?? [],
  });
}

export function requestJson(urlString, method, payload = undefined, headers = {}, timeoutMs = 30000, networkPolicy = {}) {
  return prepareTarget(urlString, networkPolicy).then(({url, lookup}) => protectOutbound(url, () => new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const data = payload === undefined ? null : JSON.stringify(payload);
    const reqHeaders = { accept: 'application/json', ...headers };
    if (data !== null) {
      reqHeaders['content-type'] = 'application/json';
      reqHeaders['content-length'] = Buffer.byteLength(data);
    }
    const req = client(url, { method, timeout: timeoutMs, headers: reqHeaders, lookup }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      let bytes = 0;
      res.on('data', (chunk) => { bytes += Buffer.byteLength(chunk); if (bytes > (networkPolicy.maxResponseBytes ?? 4_000_000)) { req.destroy(new Error('provider_response_too_large')); return; } raw += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let body = raw; try { body = raw ? JSON.parse(raw) : {}; } catch {}
          const err = new Error('provider_http_error'); err.statusCode = res.statusCode; err.providerBody = body; return reject(err);
        }
        try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('provider_invalid_json')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('provider_timeout')));
    req.on('error', reject);
    if (data !== null) req.write(data);
    req.end();
  }), {operation:'provider.requestJson'}));
}

export function requestStream(urlString, payload, headers = {}, { timeoutMs = 30000, onEvent, networkPolicy = {} } = {}) {
  return prepareTarget(urlString, networkPolicy).then(({url, lookup}) => protectOutbound(url, () => new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const data = JSON.stringify(payload);
    const reqHeaders = { accept: 'text/event-stream, application/json', 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers };
    let settled = false;
    const fail = error => { if (settled) return; settled = true; reject(error); };
    const succeed = () => { if (settled) return; settled = true; resolve(); };
    const req = client(url, { method: 'POST', timeout: timeoutMs, headers: reqHeaders, lookup }, (res) => {
      let bytes = 0;
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let raw = ''; res.setEncoding('utf8');
        res.on('data', c => { bytes += Buffer.byteLength(c); if (bytes <= (networkPolicy.maxResponseBytes ?? 4_000_000)) raw += c; });
        res.on('end', () => { const e = new Error('provider_http_error'); e.statusCode = res.statusCode; e.providerBody = raw; fail(e); });
        return;
      }
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > (networkPolicy.maxResponseBytes ?? 4_000_000)) { req.destroy(new Error('provider_response_too_large')); return; }
        buffer += chunk;
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          const event = parseStreamBlock(block);
          if (event !== null) onEvent?.(event);
        }
      });
      res.on('end', () => {
        if (settled) return;
        if (buffer.trim()) { const event = parseStreamBlock(buffer); if (event !== null) onEvent?.(event); }
        succeed();
      });
    });
    req.on('timeout', () => req.destroy(new Error('provider_timeout')));
    req.on('error', fail);
    req.write(data); req.end();
  }), {operation:'provider.requestStream'}));
}

export function parseStreamBlock(block) {
  const lines = String(block).split(/\r?\n/);
  const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
  if (!data) return null;
  if (data === '[DONE]') return { done: true };
  try { return JSON.parse(data); } catch { return { data }; }
}

export function authHeaders(apiKey, style = 'bearer') {
  if (!apiKey) return {};
  if (style === 'x-goog-api-key') return { 'x-goog-api-key': apiKey };
  return { authorization: `Bearer ${apiKey}` };
}

export function requestLineStream(urlString, payload, headers = {}, { timeoutMs = 30000, onEvent, networkPolicy = {} } = {}) {
  return prepareTarget(urlString, networkPolicy).then(({url, lookup}) => protectOutbound(url, () => new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const data = JSON.stringify(payload);
    const reqHeaders = { accept: 'application/x-ndjson, application/json', 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers };
    let settled=false; const fail=e=>{if(!settled){settled=true;reject(e);}}; const succeed=()=>{if(!settled){settled=true;resolve();}};
    const req = client(url, { method:'POST', timeout:timeoutMs, headers:reqHeaders, lookup }, res => {
      let bytes=0;
      if(res.statusCode<200||res.statusCode>=300){let raw='';res.setEncoding('utf8');res.on('data',c=>{bytes+=Buffer.byteLength(c);if(bytes<=(networkPolicy.maxResponseBytes??4_000_000))raw+=c;});res.on('end',()=>{const e=new Error('provider_http_error');e.statusCode=res.statusCode;e.providerBody=raw;fail(e);});return;}
      let buffer='';res.setEncoding('utf8');
      res.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>(networkPolicy.maxResponseBytes??4_000_000)){req.destroy(new Error('provider_response_too_large'));return;}buffer+=chunk;const lines=buffer.split(/\r?\n/);buffer=lines.pop()??'';for(const line of lines){if(!line.trim())continue;try{onEvent?.(JSON.parse(line));}catch{onEvent?.({data:line});}}});
      res.on('end',()=>{if(settled)return;if(buffer.trim()){try{onEvent?.(JSON.parse(buffer));}catch{onEvent?.({data:buffer});}}succeed();});
    });
    req.on('timeout',()=>req.destroy(new Error('provider_timeout')));req.on('error',fail);req.write(data);req.end();
  }), {operation:'provider.requestLineStream'}));
}
