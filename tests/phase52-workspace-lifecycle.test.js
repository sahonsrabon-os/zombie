import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function freePort(){const server=createServer();await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function waitHealth(child,base){for(let index=0;index<100;index++){if(child.exitCode!==null)throw new Error(`runtime exited ${child.exitCode}`);try{const response=await fetch(`${base}/health`);if(response.ok)return response.json()}catch{}await delay(100)}throw new Error('workspace_runtime_health_timeout');}
async function stop(child){if(child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(2000)]);if(child.exitCode===null)child.kill('SIGKILL');}
async function request(base,route,{method='GET',token,body,headers:extraHeaders={}}={}){const headers={...extraHeaders};if(token)headers.authorization=`Bearer ${token}`;if(body!==undefined)headers['content-type']='application/json';return fetch(`${base}${route}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});}

test('phase52 workspace selection persists per application and auto-creates project context',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'zc-phase52-workspace-'));const port=await freePort();const adminToken='phase52-admin-token';const project=path.join(dir,'editor-workspace');const globalProject=path.join(dir,'runtime-default');await mkdir(project);await mkdir(globalProject);
  const env={...process.env,HOST:'127.0.0.1',PORT:String(port),ADMIN_TOKEN:adminToken,ADMIN_UI_ENABLED:'false',LOCAL_AUTH_BYPASS:'false',DATA_DIR:path.join(dir,'runtime-data'),SQLITE_PATH:path.join(dir,'runtime-data','runtime.sqlite'),LOG_DIR:path.join(dir,'logs'),LOG_TO_STDOUT:'false',UDS_ENABLED:'false',PROVIDER_CATALOG_SYNC_ON_START:'false',PROVIDER_MODELS_REFRESH_ON_START:'false',EXTERNAL_MCP_URLS:'',ZOMBIECODER_EXECUTION_MODE:'chat-only'};
  const child=spawn(process.execPath,['src/server.js'],{cwd:root,env,stdio:'ignore'});const base=`http://127.0.0.1:${port}`;
  t.after(async()=>{await stop(child);await rm(dir,{recursive:true,force:true});});
  await waitHealth(child,base);
  assert.equal((await fetch(`${base}/admin`)).status,404);
  let response=await request(base,'/v1/admin/applications',{method:'POST',token:adminToken,body:{name:'phase52-editor'}});assert.equal(response.status,201);const created=await response.json();
  response=await request(base,'/v1/admin/applications',{method:'POST',token:adminToken,body:{name:'phase52-other-client'}});assert.equal(response.status,201);const other=await response.json();
  response=await request(base,'/api/set-working-dir',{method:'POST',token:adminToken,headers:{origin:'https://untrusted.example'},body:{applicationId:created.application.id,directory:project}});assert.equal(response.status,403);
  response=await request(base,'/api/set-working-dir',{method:'POST',token:created.apiKey,body:{applicationId:created.application.id,directory:project},headers:{'x-forwarded-for':'203.0.113.8'}});assert.equal(response.status,401);
  response=await request(base,'/api/set-working-dir',{method:'POST',token:created.apiKey,body:{directory:project}});assert.equal(response.status,200);const workspaceResponse=await response.json();assert.equal(workspaceResponse.working_dir,project);assert.match(workspaceResponse.ssot,/bytes generated/);assert.equal(workspaceResponse.ssotPath,path.join(project,'.zombiecoder','SSOT.md'));
  response=await request(base,'/api/set-working-dir',{method:'POST',token:adminToken,body:{directory:globalProject,refreshSSOT:true}});assert.equal(response.status,200);assert.equal((await response.json()).working_dir,globalProject);
  const auth=created.apiKey;
  response=await request(base,'/v1/context',{token:auth});assert.equal(response.status,200);const context=await response.json();assert.equal(context.project.path,path.join(project,'.zombiecoder','SSOT.md'));assert.match(context.project.content,new RegExp(project.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  response=await request(base,'/api/ssot');assert.equal(response.status,401);
  response=await request(base,'/api/ssot',{token:auth});assert.equal(response.status,200);assert.equal((await response.json()).project_root,project);
  response=await request(base,'/api/syllabus',{token:auth});assert.equal(response.status,200);assert.match((await response.json()).syllabus,/Agent Knowledge Syllabus/);
  response=await request(base,'/api/memory',{token:auth});assert.equal(response.status,200);assert.equal((await response.json()).path,path.join(project,'.zombiecoder','agents','memory.json'));
  response=await request(base,`/v1/context?projectRoot=${encodeURIComponent(project)}`,{token:other.apiKey});assert.equal(response.status,400);assert.equal((await response.json()).error,'project_root_not_allowed');
  response=await request(base,'/v1/context/memory',{method:'POST',token:auth,body:{kind:'decision',content:'Keep project workspace scoped to this client.'}});assert.equal(response.status,201);
  assert.match(await readFile(path.join(project,'.zombiecoder','SSOT.md'),'utf8'),/Detected Technologies/);
  assert.match(await readFile(path.join(project,'.zombiecoder','agents','syllabus.md'),'utf8'),/Agent Knowledge Syllabus/);
  const memory=JSON.parse(await readFile(path.join(project,'.zombiecoder','agents','memory.json'),'utf8'));assert.match(memory.at(-1).content,/workspace scoped/);
});