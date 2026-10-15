import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startLocalMcpFallback } from '../src/startup/local-mcp-fallback.js';
import { ExternalMcpRegistry } from '../src/registry/external-mcp.js';
import { McpRegistry } from '../src/mcp/registry.js';
import { McpPermissions } from '../src/mcp/permissions.js';
import { callMcpTool } from '../src/mcp/client.js';

class MemoryStore {
  constructor(){this.values=new Map();}
  async read(key,fallback=[]){return structuredClone(this.values.get(key)??fallback);}
  async write(key,value){this.values.set(key,structuredClone(value));}
}

async function freePort() {
  const server=createNetServer();
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}

async function fallbackFixture(t, {upstreamUrl='',existingEndpoints=[]}={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'zc-mcp-fallback-'));
  const legacyDir=path.join(root,'external-mcp','legacy');
  await mkdir(legacyDir,{recursive:true});
  const port=await freePort();
  const script=path.join(legacyDir,'fixture.cjs');
  await writeFile(script,`const http=require('node:http');const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const q=JSON.parse(raw);let result;if(q.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fallback-fixture',version:'1'}};else if(q.method==='tools/list')result={tools:[{name:'fixture_tool',inputSchema:{type:'object',properties:{},required:[]}}]};else result={content:[{type:'text',text:'fallback called'}]};res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));});server.listen(Number(process.env.TEST_MCP_PORT),'127.0.0.1');`);
  const manifestPath=path.join(root,'external-mcp','servers.json');
  await writeFile(manifestPath,JSON.stringify({localFallback:[{id:'fixture',script:'legacy/fixture.cjs',port,portEnv:'TEST_MCP_PORT',urlEnv:'EXTERNAL_MCP_FIXTURE_URL',allowHosts:['127.0.0.1'],requiresCommands:[]}],servers:[{id:'fixture',name:'Fixture MCP',urlEnv:'EXTERNAL_MCP_FIXTURE_URL',enabled:true,localFallback:true}]}));
  const env={LOCAL_MCP_FALLBACK_ENABLED:'true',MCP_ALLOW_HTTP:'true',MCP_ALLOW_PRIVATE_NETWORK:'true',EXTERNAL_MCP_FIXTURE_URL:upstreamUrl};
  const manager=await startLocalMcpFallback({root,manifestPath,env,existingEndpoints,hasCommand:()=>true,readyTimeoutMs:3000,logger:{info:async()=>{},warn:async()=>{}}});
  t.after(async()=>{await manager.stop();await rm(root,{recursive:true,force:true});});
  return {root,manager,env,port};
}

test('local MCP fallback spawns, probes, exports, and stops only its owned child',async t=>{
  const {manager,env,port}=await fallbackFixture(t);
  assert.equal(manager.results[0].status,'ready');
  assert.equal(manager.results[0].detail,'spawned');
  assert.equal(manager.results[0].toolCount,1);
  assert.equal(env.EXTERNAL_MCP_FIXTURE_URL,`http://127.0.0.1:${port}`);
  await manager.stop();
  await assert.rejects(()=>fetch(env.EXTERNAL_MCP_FIXTURE_URL,{method:'POST',body:'{}'}));
});

test('local MCP fallback leaves an explicitly configured upstream untouched',async t=>{
  const upstream='https://mcp.example.test/mcp';
  const {manager,env,port}=await fallbackFixture(t,{upstreamUrl:upstream});
  assert.equal(manager.results[0].status,'upstream-configured');
  assert.equal(env.EXTERNAL_MCP_FIXTURE_URL,upstream);
  await assert.rejects(()=>fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(500)}));
});

test('local MCP fallback does not shadow a persisted endpoint with the same ID',async t=>{
  const {manager,port}=await fallbackFixture(t,{existingEndpoints:[{id:'fixture',url:'https://upstream.example/mcp'}]});
  assert.equal(manager.results[0].status,'existing-endpoint-conflict');
  await assert.rejects(()=>fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(500)}));
});

test('local MCP fallback is disabled unless explicitly enabled',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'zc-mcp-fallback-disabled-'));
  const manifestPath=path.join(root,'servers.json');
  await writeFile(manifestPath,JSON.stringify({localFallback:[{id:'unused'}]}));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const manager=await startLocalMcpFallback({root,manifestPath,env:{},logger:{info:async()=>{},warn:async()=>{}}});
  assert.equal(manager.enabled,false);
  assert.deepEqual(manager.results,[]);
  await manager.stop();
});

test('external MCP registry applies loopback allowlist only to local fallback URLs',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'zc-mcp-manifest-'));
  await mkdir(root,{recursive:true});
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(path.join(root,'servers.json'),JSON.stringify({
    localFallback:[{id:'ocr',port:3100,allowHosts:['127.0.0.1']}],
    servers:[
      {id:'ocr',name:'OCR',urlEnv:'EXTERNAL_MCP_OCR_URL',enabled:true,localFallback:true},
      {id:'tts',name:'TTS',urlEnv:'EXTERNAL_MCP_TTS_URL',enabled:true}
    ]
  }));
  const registered=[];
  const registry=new ExternalMcpRegistry({
    root,envObject:{EXTERNAL_MCP_OCR_URL:'http://127.0.0.1:3100',EXTERNAL_MCP_TTS_URL:'https://tts.example/mcp'},
    store:{read:async()=>[],write:async()=>{}},
    mcpRegistry:{list:async()=>[],register:async input=>{registered.push(input);return input;}}
  });
  await registry.sync();
  assert.deepEqual(registered.find(item=>item.id==='ocr').allowHosts,['127.0.0.1']);
  assert.deepEqual(registered.find(item=>item.id==='tts').allowHosts,[]);
});

test('ready local fallback registers, discovers tools, grants local permission, and calls through MCP',async t=>{
  const {root,manager,env}=await fallbackFixture(t);
  assert.equal(manager.results[0].status,'ready');
  const store=new MemoryStore();
  const mcp=new McpRegistry(store,{networkPolicy:{allowHttp:true,allowPrivateNetwork:true,allowHosts:[]}});
  const external=new ExternalMcpRegistry({root:path.join(root,'external-mcp'),envObject:env,store,mcpRegistry:mcp});
  await external.sync();
  const discovered=await mcp.discover('fixture');
  assert.equal(discovered.tools[0].qualifiedName,'fixture.fixture_tool');
  const permissions=new McpPermissions(store);
  await permissions.grant({applicationId:'local-development',qualifiedName:'fixture.fixture_tool'});
  assert.equal(await permissions.allowed('local-development','fixture.fixture_tool'),true);
  const result=await callMcpTool(discovered,discovered.tools[0].name,{});
  assert.equal(result.content[0].text,'fallback called');
});
