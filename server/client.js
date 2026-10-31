// Shared helpers for talking to the offload daemon. Uses node:http rather than
// fetch because fetch times out long-polls after 5 minutes.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PORT = Number(process.env.OFFLOAD_PORT || 7777);
export const CONSOLE_URL = `http://localhost:${PORT}`;

export function call(method, path, body) {
  let req;
  const promise = new Promise((resolve, reject) => {
    req = http.request(
      { host: '127.0.0.1', port: PORT, method, path, headers: { 'content-type': 'application/json' } },
      res => {
        let s = '';
        res.on('data', d => (s += d));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(s) }); } catch (e) { reject(e); }
        });
      },
    );
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
  return { promise, abort: () => req.destroy() };
}

export async function health() {
  try {
    const { body } = await call('GET', '/health').promise;
    return body;
  } catch {
    return null;
  }
}

// Start the daemon in the background if it isn't up yet.
export async function ensureServer() {
  let h = await health();
  if (h) return h;
  const server = fileURLToPath(new URL('./server.js', import.meta.url));
  spawn(process.execPath, [server], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 30 && !h; i++) {
    await new Promise(r => setTimeout(r, 100));
    h = await health();
  }
  if (!h) throw new Error(`offload daemon did not start on port ${PORT}`);
  return h;
}

export function openConsole() {
  if (process.env.OFFLOAD_NO_OPEN) return;
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  spawn(cmd, [CONSOLE_URL], { detached: true, stdio: 'ignore' }).unref();
}
