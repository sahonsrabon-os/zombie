import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function freePort(){const server=createServer();await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function waitHealth(child,base){for(let index=0;index<100;index++){if(child.exitCode!==null)throw new Error(`runtime exited ${child.exitCode}`);try{const response=await fetch(`${base}/health`);if(response.ok)return response.json()}catch{}await delay(100)}throw new Error('packaged_runtime_health_timeout');}
async function stop(child,installation){
  if(!child)return;
  try{
    const record=JSON.parse(await readFile(path.join(installation,'.zombiecoder-runtime.pid'),'utf8'));
    if(Number.isInteger(record.pid))process.kill(record.pid,'SIGTERM');
  }catch{}
  if(child.exitCode===null){await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
}

test('phase51 builds a clean portable package and isolates two installations launched from another CWD',async t=>{
  const workspace=await mkdtemp(path.join(tmpdir(),'zc-phase51-build-'));const artifact=path.join(workspace,'package');
  const build=spawnSync(process.execPath,['scripts/build-runtime.mjs','--output',artifact],{cwd:root,encoding:'utf8'});
  assert.equal(build.status,0,build.stderr||build.stdout);
  const manifest=JSON.parse(await readFile(path.join(artifact,'.zombiecoder-build.json'),'utf8'));
  assert.equal(manifest.application,'zombiecoder-runtime-build');
  assert.ok(manifest.fileCount>100);
  assert.ok(manifest.sha256['src/server.js']);
  assert.ok(!Object.keys(manifest.sha256).some(file=>/(^|\/)(data|logs|tests|node_modules|\.env)(\/|$)/.test(file)));

  const installations=[path.join(workspace,'install-a'),path.join(workspace,'install-b')];
  await Promise.all(installations.map(destination=>cp(artifact,destination,{recursive:true})));
  const ports=await Promise.all([freePort(),freePort()]);
  const children=[];
  t.after(async()=>{await Promise.all(children.map((child,index)=>stop(child,installations[index])));await rm(workspace,{recursive:true,force:true});});
  for(let index=0;index<installations.length;index++){
    const env={...process.env,HOST:'127.0.0.1',PORT:String(ports[index]),ADMIN_TOKEN:`phase51-${index}`,LOCAL_AUTH_BYPASS:'false',UDS_ENABLED:'false',PROVIDER_CATALOG_SYNC_ON_START:'false',PROVIDER_MODELS_REFRESH_ON_START:'false',EXTERNAL_MCP_URLS:'',ZOMBIECODER_EXECUTION_MODE:'chat-only',LOG_TO_STDOUT:'false'};
    for(const key of ['DATA_DIR','SQLITE_PATH','LOG_DIR','RUNTIME_ID','INSTANCE_ID','.env'])delete env[key];
    children.push(spawn(process.execPath,[path.join(installations[index],'start.js')],{cwd:workspace,env,stdio:'ignore'}));
  }
  const health=await Promise.all(children.map((child,index)=>waitHealth(child,`http://127.0.0.1:${ports[index]}`)));
  assert.ok(health.every(item=>item.ok));
  const adminPage=await fetch(`http://127.0.0.1:${ports[0]}/admin`);assert.equal(adminPage.status,200);assert.match(await adminPage.text(),/ZombieCoder Admin/);
  for(let index=0;index<installations.length;index++)assert.ok((await stat(path.join(installations[index],'data','runtime.sqlite'))).isFile());
  const appResponse=await fetch(`http://127.0.0.1:${ports[0]}/v1/admin/applications`,{method:'POST',headers:{authorization:'Bearer phase51-0','content-type':'application/json'},body:JSON.stringify({name:'isolated-client'})});
  assert.equal(appResponse.status,201);
  const otherApps=await fetch(`http://127.0.0.1:${ports[1]}/v1/admin/applications`,{headers:{authorization:'Bearer phase51-1'}}).then(response=>response.json());
  assert.equal(otherApps.applications.length,0);
  assert.notEqual(path.join(installations[0],'data','runtime.sqlite'),path.join(installations[1],'data','runtime.sqlite'));
});