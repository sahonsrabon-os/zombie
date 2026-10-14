import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadEnvFile } from '../src/config/env-loader.js';
import { SystemLogger } from '../src/core/logger.js';
import { PersonaRegistry } from '../src/agents/persona-registry.js';
import { AgentRunner } from '../src/agents/runner.js';

function memoryStore() {
  const data = new Map();
  return {
    async read(key, fallback=[]) { return data.has(key) ? data.get(key) : fallback; },
    async write(key, value) { data.set(key, value); return value; }
  };
}

test('env loader reads .env without overriding an existing process environment value', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zc-env-'));
  const file = path.join(dir, '.env');
  const previous = process.env.ZC_PHASE16_EXISTING;
  process.env.ZC_PHASE16_EXISTING = 'process-wins';
  await writeFile(file, 'ZC_PHASE16_EXISTING=file-loses\nZC_PHASE16_NEW="loaded value"\n# comment\n', 'utf8');
  const result = loadEnvFile({cwd:dir});
  assert.equal(result.loaded, true);
  assert.equal(process.env.ZC_PHASE16_EXISTING, 'process-wins');
  assert.equal(process.env.ZC_PHASE16_NEW, 'loaded value');
  if (previous === undefined) delete process.env.ZC_PHASE16_EXISTING; else process.env.ZC_PHASE16_EXISTING = previous;
  delete process.env.ZC_PHASE16_NEW;
  await rm(dir, {recursive:true, force:true});
});

test('system logger writes structured JSONL and redacts secrets/payloads', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zc-log-'));
  const logger = new SystemLogger({dir, file:'runtime.jsonl', level:'debug', stdout:false, maxBytes:1024*1024, maxFiles:2});
  await logger.info('test.event', {requestId:'req-1', token:'secret-value', content:'private message', status:'ok'});
  const raw = await readFile(path.join(dir, 'runtime.jsonl'), 'utf8');
  const row = JSON.parse(raw.trim());
  assert.equal(row.event, 'test.event');
  assert.equal(row.token, '[REDACTED]');
  assert.match(row.content, /^\[omitted:/);
  assert.equal(row.requestId, 'req-1');
  await rm(dir, {recursive:true, force:true});
});

test('agent/persona boundary emits identity metadata into system logs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zc-agent-log-'));
  const logger = new SystemLogger({dir, file:'runtime.jsonl', level:'debug', stdout:false});
  const store = memoryStore();
  const personas = new PersonaRegistry(store, logger);
  const registry = { resolve: async () => ({id:'code-guru',name:'Code Guru'}) };
  const runner = new AgentRunner({registry, personas, evidenceGate:{canClaimSuccess:() => false}, logger});
  const prepared = await runner.prepare({agentId:'code-guru', personaId:'code-guru', goal:'inspect architecture'});
  assert.equal(prepared.agent.id, 'code-guru');
  assert.equal(prepared.persona.id, 'code-guru');
  const raw = await readFile(path.join(dir, 'runtime.jsonl'), 'utf8');
  assert.match(raw, /"event":"persona\.resolved"/);
  assert.match(raw, /"event":"agent\.prepared"/);
  assert.match(raw, /"agentId":"code-guru"/);
  assert.match(raw, /"personaId":"code-guru"/);
  await rm(dir, {recursive:true, force:true});
});
