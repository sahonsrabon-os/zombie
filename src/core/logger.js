import { mkdir, appendFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';

const LEVELS = {error:0, warn:1, info:2, debug:3, trace:4};
const SECRET_KEY = /(token|secret|password|passwd|authorization|api[-_]?key|cookie|set-cookie|credential)/i;

function sanitize(value, {allowPayloads = false} = {}, depth = 0) {
  if (depth > 5) return '[max-depth]';
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (!allowPayloads && typeof value === 'string' && value.length > 2000) return `[redacted-long-string:${value.length}]`;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, {allowPayloads}, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 200)) {
      if (SECRET_KEY.test(key)) out[key] = '[REDACTED]';
      else if (!allowPayloads && /(messages?|content|arguments|prompt|body|payload|data)/i.test(key)) {
        if (Array.isArray(item)) out[key] = `[omitted:${item.length} items]`;
        else if (typeof item === 'string') out[key] = `[omitted:${item.length} chars]`;
        else out[key] = '[omitted]';
      } else out[key] = sanitize(item, {allowPayloads}, depth + 1);
    }
    return out;
  }
  return String(value);
}

export class SystemLogger {
  constructor({dir='./logs', file='runtime.jsonl', level='info', stdout=true, maxBytes=10*1024*1024, maxFiles=7, allowPayloads=false} = {}) {
    this.dir = path.resolve(dir);
    this.file = file;
    this.level = LEVELS[level] === undefined ? LEVELS.info : LEVELS[level];
    this.stdout = stdout;
    this.maxBytes = Math.max(1024, Number(maxBytes) || 10 * 1024 * 1024);
    this.maxFiles = Math.max(1, Number(maxFiles) || 7);
    this.allowPayloads = Boolean(allowPayloads);
    this.chain = Promise.resolve();
  }

  child(base = {}) { return new LogContext(this, base); }
  enabled(level) { return (LEVELS[level] ?? LEVELS.info) <= this.level; }

  log(level, event, fields = {}) {
    if (!this.enabled(level)) return Promise.resolve();
    const entry = {
      ts: new Date().toISOString(),
      level,
      event: String(event),
      ...sanitize(fields, {allowPayloads: this.allowPayloads})
    };
    const line = JSON.stringify(entry) + '\n';
    if (this.stdout) process.stdout.write(line);
    this.chain = this.chain.then(async () => {
      await mkdir(this.dir, {recursive:true});
      const target = path.join(this.dir, this.file);
      await this.rotateIfNeeded(target, Buffer.byteLength(line));
      await appendFile(target, line, 'utf8');
    }).catch(() => {});
    return this.chain;
  }

  async rotateIfNeeded(target, incomingBytes) {
    try {
      const info = await stat(target);
      if (info.size + incomingBytes <= this.maxBytes) return;
    } catch { return; }
    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      const from = `${target}.${index}`;
      const to = `${target}.${index + 1}`;
      try { await rename(from, to); } catch {}
    }
    try { await rename(target, `${target}.1`); } catch {}
  }

  error(event, fields) { return this.log('error', event, fields); }
  warn(event, fields) { return this.log('warn', event, fields); }
  info(event, fields) { return this.log('info', event, fields); }
  debug(event, fields) { return this.log('debug', event, fields); }
  trace(event, fields) { return this.log('trace', event, fields); }
}

export class LogContext {
  constructor(logger, base = {}) { this.logger = logger; this.base = {...base}; }
  child(fields = {}) { return new LogContext(this.logger, {...this.base, ...fields}); }
  log(level, event, fields = {}) { return this.logger.log(level, event, {...this.base, ...fields}); }
  error(event, fields) { return this.log('error', event, fields); }
  warn(event, fields) { return this.log('warn', event, fields); }
  info(event, fields) { return this.log('info', event, fields); }
  debug(event, fields) { return this.log('debug', event, fields); }
  trace(event, fields) { return this.log('trace', event, fields); }
}
