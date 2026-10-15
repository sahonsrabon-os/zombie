import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { open, mkdir, readFile, unlink } from 'node:fs/promises';

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

async function reclaimStaleLock(lockPath, identity, processAlive) {
  let contents;
  let existing;
  try {
    contents = await readFile(lockPath, 'utf8');
    existing = JSON.parse(contents);
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    return false;
  }

  if (existing.hostname !== identity.hostname || existing.platform !== identity.platform || !Number.isSafeInteger(existing.pid) || existing.pid < 1) return false;
  if (await processAlive(existing.pid)) return false;

  try {
    if (await readFile(lockPath, 'utf8') !== contents) return false;
    await unlink(lockPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

async function createLock(lockPath, identity) {
  const handle = await open(lockPath, 'wx');
  try {
    await handle.writeFile(JSON.stringify({ ...identity, acquiredAt: new Date().toISOString() }) + '\n');
  } catch (error) {
    await handle.close();
    await unlink(lockPath).catch(() => {});
    throw error;
  }
  return async () => {
    try { await handle.close(); } finally { await unlink(lockPath).catch(() => {}); }
  };
}

export function createRuntimeIdentity(config = {}) {
  const port = Number(config.port);
  const runtimeId = String(process.env.RUNTIME_ID || `runtime-${port}`);
  const instanceId = String(process.env.INSTANCE_ID || randomUUID());
  const pid = process.pid;
  const host = String(config.host || '127.0.0.1');
  return Object.freeze({
    runtimeId, instanceId, pid, host, port,
    hostname: os.hostname(),
    platform: process.platform,
    nodeVersion: process.version,
  });
}

export async function acquireRuntimeLock(dataDir, identity, { processAlive = isProcessAlive } = {}) {
  await mkdir(dataDir, { recursive: true });
  const safe = identity.runtimeId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const lockPath = path.resolve(dataDir, `runtime-${safe}.lock`);
  try {
    return await createLock(lockPath, identity);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const reclaimed = await reclaimStaleLock(lockPath, identity, processAlive);
    if (reclaimed) {
      try { return await createLock(lockPath, identity); }
      catch (retryError) {
        if (retryError.code !== 'EEXIST') throw retryError;
      }
    }
    throw new Error(`runtime_instance_already_locked:${identity.runtimeId}`);
  }
}
