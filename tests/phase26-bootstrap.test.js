import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { buildBoundedContext } from '../src/context/context-budget.js';
import { providerModelKey, mergeProviderCatalog } from '../src/providers/sync.js';
import { parseProviderBootConfig } from '../src/startup/provider-bootstrap.js';
import { acquireRuntimeLock } from '../src/runtime/identity.js';

test('runtime lock reclaims a dead same-host owner and preserves live locks', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'zc-runtime-lock-'));
  t.after(() => rm(dataDir, {recursive:true,force:true}));
  const identity = {runtimeId:'runtime-test',instanceId:'current',pid:process.pid,host:'127.0.0.1',port:3000,hostname:os.hostname(),platform:process.platform,nodeVersion:process.version};
  const lockPath = path.join(dataDir, 'runtime-runtime-test.lock');
  await writeFile(lockPath, JSON.stringify({...identity,pid:987654321,instanceId:'stale'})+'\n');

  const release = await acquireRuntimeLock(dataDir, identity, {processAlive:async()=>false});
  assert.equal(JSON.parse(await readFile(lockPath,'utf8')).instanceId, 'current');
  await release();
  await assert.rejects(() => readFile(lockPath), {code:'ENOENT'});

  await writeFile(lockPath, JSON.stringify({...identity,pid:process.pid,instanceId:'live'})+'\n');
  await assert.rejects(
    () => acquireRuntimeLock(dataDir, identity, {processAlive:async()=>true}),
    /runtime_instance_already_locked/
  );
  assert.equal(JSON.parse(await readFile(lockPath,'utf8')).instanceId, 'live');
});

test('provider model identity is scoped by provider id', () => {
  assert.equal(providerModelKey('p1','model-x'),'p1:model-x');
  assert.notEqual(providerModelKey('p1','model-x'),providerModelKey('p2','model-x'));
});

test('provider catalog merges models without cross-provider collision', () => {
  const out=mergeProviderCatalog([], {providers:[{id:'p1',baseUrl:'https://p1.test'},{id:'p2',baseUrl:'https://p2.test'}],models:[{providerId:'p1',id:'same'},{providerId:'p2',id:'same'}]});
  assert.deepEqual(out.find(x=>x.id==='p1').models,['same']);
  assert.deepEqual(out.find(x=>x.id==='p2').models,['same']);
});

test('provider boot config rejects non-array JSON', () => {
  assert.throws(()=>parseProviderBootConfig('{"id":"x"}'),/must_be_array/);
});

test('context budget keeps recent messages and bounds archive', () => {
  const r=buildBoundedContext({userInput:'find auth bug',recent:Array.from({length:10},(_,i)=>({role:'user',content:'recent '+i})),archive:Array.from({length:100},(_,i)=>({role:'user',content:i===50?'auth bug important':'noise '+i})),maxBytes:64*1024});
  assert.equal(r.recent.length,10);
  assert.ok(r.archive.some(x=>String(x.content).includes('auth bug')));
  assert.ok(Buffer.byteLength(JSON.stringify(r))<=64*1024);
});
