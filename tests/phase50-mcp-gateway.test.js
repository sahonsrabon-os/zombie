import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { isMcpOriginAllowed } from '../src/mcp/origin-policy.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function freePort(){const server=createNetServer();await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function waitHealth(child,base){for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error(`runtime exited ${child.exitCode}`);try{const response=await fetch(`${base}/health`);if(response.ok)return response.json()}catch{}await delay(100)}throw new Error('runtime_health_timeout');}
async function request(base,route,{method='GET',token,origin,body,headers:extraHeaders={}}={}){const headers={...extraHeaders};if(token)headers.authorization=`Bearer ${token}`;if(origin)headers.origin=origin;if(body!==undefined)headers['content-type']='application/json';return fetch(`${base}${route}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});}

test('MCP origin policy allows exact same-origin and configured origins but not CORS in local bypass mode',()=>{
  assert.equal(isMcpOriginAllowed({origin:'https://infiniteearningzone.com',host:'infiniteearningzone.com',protocol:'https',allowedOrigins:[],allowCrossOrigin:false}),true);
  assert.equal(isMcpOriginAllowed({origin:'https://infiniteearningzone.com',host:'127.0.0.1:3000',protocol:'http',allowedOrigins:['https://infiniteearningzone.com']}),true);
  assert.equal(isMcpOriginAllowed({origin:'https://untrusted.example',host:'127.0.0.1:3000',protocol:'http',allowedOrigins:['https://infiniteearningzone.com']}),false);
  assert.equal(isMcpOriginAllowed({origin:'https://infiniteearningzone.com',host:'127.0.0.1:3000',protocol:'http',allowedOrigins:['https://infiniteearningzone.com'],allowCrossOrigin:false}),false);
});

test('phase50 serves authenticated MCP JSON-RPC through the legacy gateway routes',async t=>{
  const upstream=createHttpServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const input=JSON.parse(raw);
    let result;
    if(input.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'phase50-fixture',version:'1'}};
    else if(input.method==='tools/list')result={tools:[{name:'echo',description:'Return input text',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}]};
    else if(input.method==='tools/call')result={content:[{type:'text',text:input.params.arguments.text}]};
    else result={error:{code:-32601,message:'method not found'}};
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:input.id,result}));
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const port=await freePort();const dir=await mkdtemp(path.join(tmpdir(),'zc-phase50-mcp-'));const adminToken='phase50-admin-token';const workspace=path.join(dir,'data','editor-workspace');await mkdir(workspace,{recursive:true});await writeFile(path.join(dir,'data','fixture.txt'),'internal tool works');await writeFile(path.join(workspace,'fixture.txt'),'editor workspace tool works');
  const env={...process.env,HOST:'127.0.0.1',PORT:String(port),ADMIN_TOKEN:adminToken,LOCAL_AUTH_BYPASS:'false',DATA_DIR:path.join(dir,'data'),SQLITE_PATH:path.join(dir,'data','runtime.sqlite'),LOG_DIR:path.join(dir,'logs'),LOG_TO_STDOUT:'false',UDS_ENABLED:'false',PROVIDER_CATALOG_SYNC_ON_START:'false',PROVIDER_MODELS_REFRESH_ON_START:'false',EXTERNAL_MCP_URLS:'',MCP_ALLOW_HTTP:'true',MCP_ALLOW_PRIVATE_NETWORK:'true',MCP_ALLOW_HOSTS:'127.0.0.1',MCP_ALLOWED_ORIGINS:'https://infiniteearningzone.com',ZOMBIECODER_EXECUTION_MODE:'tools-enabled'};
  const child=spawn(process.execPath,['src/server.js'],{cwd:root,env,stdio:'ignore'});const base=`http://127.0.0.1:${port}`;const adminHeaders={token:adminToken};
  t.after(async()=>{child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(2000)]);if(child.exitCode===null)child.kill('SIGKILL');await new Promise(resolve=>upstream.close(resolve));await rm(dir,{recursive:true,force:true});});
  await waitHealth(child,base);

  let response=await request(base,'/api/version');assert.equal(response.status,200);assert.ok((await response.json()).version);
  response=await request(base,'/api/config/mcp');const config=await response.json();assert.equal(config.mcpServerAvailable,true);assert.equal(new URL(config.transport.url).pathname,'/mcp');
  response=await request(base,'/mcp',{method:'OPTIONS',origin:'https://infiniteearningzone.com'});assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),'https://infiniteearningzone.com');assert.match(response.headers.get('access-control-allow-headers'),/mcp-protocol-version/i);
  response=await request(base,'/v1/mcp',{method:'OPTIONS',origin:'https://infiniteearningzone.com'});assert.equal(response.status,204);
  response=await request(base,'/mcp',{method:'OPTIONS',origin:'https://untrusted.example'});assert.equal(response.status,403);
  response=await request(base,'/mcp',{method:'POST',origin:'https://untrusted.example',body:{jsonrpc:'2.0',id:1,method:'initialize',params:{}}});assert.equal(response.status,403);
  response=await request(base,'/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}}});assert.equal(response.status,200);assert.equal(response.headers.get('mcp-protocol-version'),'2025-03-26');assert.equal((await response.json()).result.protocolVersion,'2025-03-26');
  response=await request(base,'/mcp',{method:'POST',body:{jsonrpc:'2.0',id:2,method:'tools/list',params:{}}});assert.equal(response.status,401);

  response=await request(base,'/v1/admin/applications',{method:'POST',...adminHeaders,body:{name:'phase50-client'}});assert.equal(response.status,201);const application=await response.json();
  response=await request(base,'/v1/admin/mcp/endpoints',{method:'POST',...adminHeaders,body:{id:'phase50-fixture',name:'Phase 50 fixture',url:`http://127.0.0.1:${upstream.address().port}/mcp`}});assert.equal(response.status,201);
  response=await request(base,'/v1/admin/mcp/endpoints/phase50-fixture/discover',{method:'POST',...adminHeaders,body:{}});assert.equal(response.status,200);
  const qualifiedName='phase50-fixture.echo';
  response=await request(base,'/v1/admin/mcp/permissions',{method:'POST',...adminHeaders,body:{applicationId:application.application.id,qualifiedName}});assert.equal(response.status,201);
  response=await request(base,'/mcp',{method:'POST',token:application.apiKey,body:{jsonrpc:'2.0',id:8,method:'tools/list',params:{}}});assert.equal(response.status,200);const localToolNames=(await response.json()).result.tools.map(tool=>tool.name);assert.ok(localToolNames.includes('set_working_dir'));assert.ok(localToolNames.includes('get_working_dir'));
  response=await request(base,'/mcp',{method:'GET',token:application.apiKey,origin:'https://infiniteearningzone.com'});assert.equal(response.status,200);assert.ok(!(await response.json()).tools.some(tool=>tool.name==='set_working_dir'));
  response=await request(base,'/mcp',{method:'POST',token:application.apiKey,headers:{'x-forwarded-for':'203.0.113.10'},body:{jsonrpc:'2.0',id:9,method:'tools/call',params:{name:'set_working_dir',arguments:{directory:workspace}}}});assert.equal(response.status,404);
  response=await request(base,'/mcp',{method:'POST',token:application.apiKey,body:{jsonrpc:'2.0',id:10,method:'tools/call',params:{name:'set_working_dir',arguments:{directory:workspace}}}});assert.equal(response.status,200);assert.match((await response.json()).result.content[0].text,new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(await readFile(path.join(workspace,'.zombiecoder','SSOT.md'),'utf8'),/Project SSOT/);
  response=await request(base,'/mcp',{method:'POST',token:application.apiKey,body:{jsonrpc:'2.0',id:11,method:'tools/call',params:{name:'get_working_dir',arguments:{}}}});assert.equal(response.status,200);assert.match((await response.json()).result.content[0].text,new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  response=await request(base,'/mcp',{method:'POST',token:application.apiKey,body:{jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'read_file',arguments:{path:'fixture.txt'}}}});assert.equal(response.status,404);assert.equal((await response.json()).error.message,'mcp_tool_not_found');
  response=await request(base,'/v1/admin/tools/permissions',{method:'POST',...adminHeaders,body:{applicationId:application.application.id,toolId:'read_file'}});assert.equal(response.status,201);

  response=await request(base,'/mcp',{method:'POST',token:application.apiKey,body:{jsonrpc:'2.0',id:3,method:'tools/list',params:{}}});assert.equal(response.status,200);const listedTools=(await response.json()).result.tools;assert.ok(listedTools.some(tool=>tool.name===qualifiedName));assert.ok(listedTools.some(tool=>tool.name==='read_file'));
  response=await request(base,'/mcp',{method:'GET',token:application.apiKey});assert.equal(response.status,200);assert.equal((await response.json()).tools[0].name,qualifiedName);
  response=await request(base,'/mcp',{method:'POST',token:application.apiKey,body:{jsonrpc:'2.0',id:4,method:'tools/call',params:{name:qualifiedName,arguments:{text:'gate connected'}}}});const toolCall=await response.json();if(!response.ok){const log=await readFile(path.join(dir,'logs','runtime.jsonl'),'utf8');const errors=log.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)).filter(event=>event.event==='mcp.tool_call.failed');assert.fail(JSON.stringify({toolCall,error:errors.at(-1)}));}assert.equal(toolCall.result.content[0].text,'gate connected');
  response=await request(base,'/mcp',{method:'POST',token:application.apiKey,body:{jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'read_file',arguments:{path:'fixture.txt'}}}});assert.equal(response.status,200);assert.equal((await response.json()).result.content[0].text,'editor workspace tool works');
  response=await request(base,'/v1/mcp',{method:'POST',body:{jsonrpc:'2.0',id:5,method:'initialize',params:{}}});assert.equal(response.status,200);
});