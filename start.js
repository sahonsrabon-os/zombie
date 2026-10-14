#!/usr/bin/env node
'use strict';

// ZombieCoder runtime launcher: env is the source of boot configuration.
// Phase 48: cross-platform root resolution, Node preflight, port ownership diagnostics and PID safety.
// It stops only the PID recorded for this runtime/port, never a broad node kill.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { RUNTIME_PHASE } from './src/runtime/version.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 5)) {
  console.error(`[ZombieCoder] Unsupported Node.js ${process.versions.node}. Required: Node.js >=22.5.0 (node:sqlite is required).`);
  process.exit(2);
}
const envFile = path.join(root, '.env');
const pidFile = path.join(root, '.zombiecoder-runtime.pid');
const childEnv = { ...process.env };

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    childEnv[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadDotEnv(envFile);
const defaultPort = Number(childEnv.PORT || 3000);
const effectivePort = Number(childEnv.PORT || defaultPort);
const effectiveHost = childEnv.HOST || '127.0.0.1';
if (!Number.isInteger(effectivePort) || effectivePort < 1 || effectivePort > 65535) {
  console.error(`[ZombieCoder] Invalid PORT=${childEnv.PORT}; expected integer 1..65535. No fallback port will be scanned.`);
  process.exit(2);
}
const runtimeId = childEnv.RUNTIME_ID || `runtime-${effectivePort}`;
const runtimePhase = childEnv.RUNTIME_PHASE || String(RUNTIME_PHASE);
childEnv.RUNTIME_ID = runtimeId;
childEnv.RUNTIME_PHASE = runtimePhase;
childEnv.INSTANCE_ID = childEnv.INSTANCE_ID || randomUUID();

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function processCommandLine(pid) {
  try {
    if (process.platform === 'win32') return execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',`(Get-CimInstance Win32_Process -Filter \"ProcessId = ${Number(pid)}\").CommandLine`], {encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0',' ');
  } catch { return ''; }
}
function isOurRuntimeProcess(pid) {
  const command = processCommandLine(pid).replaceAll('\\','/').toLowerCase();
  const target = path.join(root,'src','server.js').replaceAll('\\','/').toLowerCase();
  return Boolean(command && command.includes(target));
}
function readPidRecord() {
  if (!existsSync(pidFile)) return null;
  try { const raw=readFileSync(pidFile,'utf8').trim(); if(raw.startsWith('{')) return JSON.parse(raw); return {pid:Number(raw),legacy:true}; } catch { return null; }
}
async function stopPid(pid) {
  if (!pidAlive(pid)) return false;
  if (!isOurRuntimeProcess(pid)) { console.error(`[ZombieCoder] PID ${pid} does not match this runtime command line; refusing to terminate an unrelated process.`); return false; }
  try { process.kill(pid, 'SIGTERM'); } catch { return false; }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (!pidAlive(pid)) return true; await new Promise(r => setTimeout(r, 100)); }
  try { process.kill(pid, 'SIGKILL'); return true; } catch { return false; }
}
function portBusy() {
  return new Promise(resolve => {
    const s = createConnection({host: effectiveHost, port: effectivePort});
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.setTimeout(500, () => { s.destroy(); resolve(false); });
  });
}
function explainPortOwner() {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], {encoding:'utf8', stdio:['ignore','pipe','ignore']});
      const rows = output.split(/\r?\n/).filter(line => line.includes(`:${effectivePort}`) && /LISTENING/i.test(line));
      return rows.slice(0, 8).join('\n') || 'netstat found no matching listener row (permissions or address-family mismatch).';
    }
    const output = execFileSync('sh', ['-c', 'command -v ss >/dev/null 2>&1 && ss -ltnp || (command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP -sTCP:LISTEN) || true'], {encoding:'utf8', stdio:['ignore','pipe','ignore']});
    const rows = output.split(/\r?\n/).filter(line => line.includes(`:${effectivePort}`));
    return rows.slice(0, 8).join('\n') || 'ss/lsof found no matching listener row; process details may require elevated permissions.';
  } catch { return 'Could not inspect listener owner with OS tools.'; }
}

if (process.argv.includes('--stop')) {
  const record=readPidRecord();
  if (record && Number.isInteger(Number(record.pid))) await stopPid(Number(record.pid));
  try { unlinkSync(pidFile); } catch {}
  process.exit(0);
}

if (existsSync(pidFile)) {
  const record=readPidRecord(); const pid=Number(record?.pid);
  if (Number.isInteger(pid) && pidAlive(pid)) {
    if (!isOurRuntimeProcess(pid)) { console.error(`[ZombieCoder] PID file points to PID ${pid}, but its command line is not this runtime. Refusing to kill it; inspect ${pidFile} manually.`); process.exit(2); }
    await stopPid(pid);
  }
  try { unlinkSync(pidFile); } catch {}
}
console.log(`[ZombieCoder] Runtime launcher | Node.js ${process.versions.node} | phase ${runtimePhase}`);
console.log(`[ZombieCoder] Root: ${root}`);
console.log(`[ZombieCoder] HTTP bind: ${effectiveHost}:${effectivePort} (PORT/HOST from environment or .env; no fallback port scan)`);
console.log(`[ZombieCoder] Runtime ID: ${runtimeId}`);
if (await portBusy()) {
  console.error(`[ZombieCoder] port ${effectiveHost}:${effectivePort} is already in use; refusing blind process kill.`);
  console.error('[ZombieCoder] Listener owner evidence:');
  console.error(explainPortOwner());
  console.error('[ZombieCoder] Check the PID above with your OS process manager, then stop the intended service explicitly.');
  process.exit(2);
}

const child = spawn(process.execPath, [path.join(root, 'src', 'server.js')], {
  cwd: root,
  env: childEnv,
  stdio: 'inherit'
});
writeFileSync(pidFile, JSON.stringify({pid:child.pid,runtimeId,port:effectivePort,startedAt:new Date().toISOString(),command:path.join(root,'src','server.js')},null,2));
const cleanup = () => { try { unlinkSync(pidFile); } catch {} };
child.on('exit', (code, signal) => { cleanup(); process.exit(code ?? (signal ? 1 : 0)); });
process.on('SIGINT', () => { try { child.kill('SIGINT'); } catch {} });
process.on('SIGTERM', () => { try { child.kill('SIGTERM'); } catch {} });
