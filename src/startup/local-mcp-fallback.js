import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function commandAvailable(command) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    execFileSync(locator, [command], {stdio:'ignore',windowsHide:true});
    return true;
  } catch {
    return false;
  }
}

function portListening(port) {
  return new Promise(resolve => {
    const socket = net.connect({host:'127.0.0.1',port});
    let settled = false;
    const done = value => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500);
    socket.once('connect',() => done(true));
    socket.once('timeout',() => done(false));
    socket.once('error',() => done(false));
  });
}

async function postMcp(url, method, id, timeoutMs) {
  const response = await fetch(url, {
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id,method,params:{}}),
    signal:AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`mcp_http_${response.status}`);
  const value = await response.json();
  if (value?.jsonrpc !== '2.0' || value?.id !== id || value?.error) throw new Error('mcp_response_invalid');
  return value;
}

async function probeMcp(url, timeoutMs=1200) {
  await postMcp(url,'initialize','fallback-init',timeoutMs);
  const listed = await postMcp(url,'tools/list','fallback-tools',timeoutMs);
  if (!Array.isArray(listed?.result?.tools) || listed.result.tools.length === 0) throw new Error('mcp_tools_empty');
  return listed.result.tools.length;
}

function urlFor(entry) {
  return `http://127.0.0.1:${entry.port}`;
}

function hostIsLoopback(value) {
  try { return new URL(value).hostname === '127.0.0.1'; }
  catch { return false; }
}

function skipResult(entry, status, detail='') {
  return {id:entry.id,status,port:entry.port,detail};
}

async function terminateChild(child,graceMs=1500) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try { child.kill('SIGTERM'); } catch {}
  await new Promise(resolve=>{
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer=setTimeout(()=>resolve(),graceMs);
    child.once('exit',()=>{clearTimeout(timer);resolve();});
  });
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL'); } catch {}
  }
}

export async function startLocalMcpFallback({root=process.cwd(),env=process.env,logger=null,enabled=undefined,manifestPath=path.join(root,'external-mcp','servers.json'),existingEndpoints=[],readyTimeoutMs=8000,probe=probeMcp,hasCommand=commandAvailable}={}) {
  const children = new Map();
  const results = [];
  let stopped = false;

  const killOnExit = () => {
    for (const child of children.values()) {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGKILL'); } catch {}
      }
    }
  };

  async function stop() {
    if (stopped) return;
    stopped = true;
    process.removeListener('exit',killOnExit);
    const active = [...children.values()].filter(child => child.exitCode === null && child.signalCode === null);
    await Promise.all(active.map(child=>terminateChild(child,2000)));
    children.clear();
  }

  if (!(enabled ?? env.LOCAL_MCP_FALLBACK_ENABLED === 'true')) {
    return {enabled:false,results,stop};
  }
  if (env.MCP_ALLOW_HTTP !== 'true' || env.MCP_ALLOW_PRIVATE_NETWORK !== 'true') {
    await logger?.warn?.('local_mcp_fallback.disabled',{reason:'mcp_http_private_policy_required'});
    return {enabled:true,results:[{id:'local-fallback',status:'policy-disabled',detail:'enable MCP_ALLOW_HTTP and MCP_ALLOW_PRIVATE_NETWORK'}],stop};
  }

  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath,'utf8')); }
  catch (error) {
    await logger?.warn?.('local_mcp_fallback.manifest_failed',{code:String(error?.code ?? 'manifest_invalid')});
    return {enabled:true,results:[{id:'local-fallback',status:'manifest-error'}],stop};
  }

  process.once('exit',killOnExit);
  for (const entry of manifest.localFallback ?? []) {
    if (!entry || entry.enabled === false || !entry.id || !entry.script || !entry.port || !entry.urlEnv) continue;
    if (Array.isArray(entry.platforms) && !entry.platforms.includes(process.platform)) {
      results.push(skipResult(entry,'unsupported-platform',process.platform));
      continue;
    }
    if (entry.requiresDisplay && !env.DISPLAY) {
      results.push(skipResult(entry,'display-unavailable'));
      continue;
    }

    const configuredUrl = String(env[entry.urlEnv] ?? '').trim();
    if (configuredUrl && configuredUrl !== urlFor(entry)) {
      results.push(skipResult(entry,'upstream-configured'));
      continue;
    }
    const url = configuredUrl || urlFor(entry);
    const existingEndpoint=existingEndpoints.find(endpoint=>endpoint.id===entry.id);
    if (existingEndpoint?.url && existingEndpoint.url!==url) {
      results.push(skipResult(entry,'existing-endpoint-conflict'));
      continue;
    }
    if (!hostIsLoopback(url)) {
      results.push(skipResult(entry,'non-loopback-fallback-url'));
      continue;
    }

    const missingCommands = (entry.requiresCommands ?? []).filter(command => !hasCommand(command));
    if (missingCommands.length) {
      results.push(skipResult(entry,'dependency-missing',missingCommands.join(',')));
      continue;
    }

    if (await probe(url).then(() => true,() => false)) {
      env[entry.urlEnv] = url;
      results.push({...skipResult(entry,'ready','already-running'),url});
      continue;
    }
    if (await portListening(entry.port)) {
      results.push(skipResult(entry,'port-conflict'));
      continue;
    }

    const externalRoot = path.dirname(manifestPath);
    const script = path.resolve(externalRoot,entry.script);
    if (!script.startsWith(`${path.resolve(externalRoot)}${path.sep}`)) {
      results.push(skipResult(entry,'script-outside-fallback-root'));
      continue;
    }
    try { await mkdir(path.join(root,env.LOG_DIR || 'logs'),{recursive:true}); } catch {}

    const childEnv = {...env,[entry.portEnv || `${entry.id.toUpperCase().replace(/-/g,'_')}_MCP_PORT`]:String(entry.port)};
    const child = spawn(process.execPath,[script],{cwd:root,env:childEnv,stdio:'ignore',windowsHide:true,detached:false});
    children.set(entry.id,child);
    let childError = null;
    child.once('error',error => { childError=error; });

    let toolCount = 0;
    let failure = null;
    const deadline = Date.now()+readyTimeoutMs;
    while (Date.now()<deadline) {
      if (childError) { failure='spawn-error'; break; }
      if (child.exitCode !== null || child.signalCode !== null) { failure='child-exited'; break; }
      try { toolCount=await probe(url); break; }
      catch { await delay(200); }
    }
    if (!toolCount) {
      if (!failure) failure='readiness-timeout';
      await terminateChild(child);
      children.delete(entry.id);
      results.push(skipResult(entry,failure));
      continue;
    }

    env[entry.urlEnv] = url;
    results.push({...skipResult(entry,'ready','spawned'),url,toolCount,pid:child.pid});
  }

  await logger?.info?.('local_mcp_fallback.started',{enabled:true,ready:results.filter(item=>item.status==='ready').length,skipped:results.filter(item=>item.status!=='ready').length,results});
  return {enabled:true,results,stop};
}
