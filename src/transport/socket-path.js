import path from 'node:path';

export function normalizeUdsSocketPath(socketPath, runtimeId = 'runtime') {
  const raw = String(socketPath || '').trim();
  if (!raw) return raw;

  if (process.platform !== 'win32') return raw;

  if (raw.startsWith('\\\\.\\pipe\\') || raw.startsWith('//./pipe/')) {
    return raw;
  }

  const baseName = path.basename(raw, path.extname(raw)) || 'runtime';
  const safeName = `${runtimeId || 'runtime'}-${baseName}`
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'runtime';

  return `\\\\.\\pipe\\${safeName}`;
}
