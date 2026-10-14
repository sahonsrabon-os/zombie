import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { open, mkdir } from 'node:fs/promises';

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

export async function acquireRuntimeLock(dataDir, identity) {
  await mkdir(dataDir, { recursive: true });
  const safe = identity.runtimeId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const lockPath = path.resolve(dataDir, `runtime-${safe}.lock`);
  let handle;
  try {
    handle = await open(lockPath, 'wx');
    await handle.writeFile(JSON.stringify({ ...identity, acquiredAt: new Date().toISOString() }) + '\n');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`runtime_instance_already_locked:${identity.runtimeId}`);
    throw error;
  }
  return async () => {
    try { await handle.close(); } finally {
      const { unlink } = await import('node:fs/promises');
      try { await unlink(lockPath); } catch {}
    }
  };
}
