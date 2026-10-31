#!/usr/bin/env node
// offload daemon: holds the queue of binary questions from every agent and
// serves the Z/X console. One instance per machine, shared by all sessions.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PORT } from './client.js';

const UI = new URL('./ui.html', import.meta.url);

const queue = []; // { id, question, options, context, source, kind, createdAt, res }
const clients = new Set(); // browser consoles (SSE)
const waiters = new Set(); // desktop panes long-polling /queue
let version = 0;
let lastPollAt = 0;

const view = ({ res, ...item }) => item;

// A pane counts as an open console while it is polling.
const consoles = () => clients.size + (waiters.size > 0 || Date.now() - lastPollAt < 5000 ? 1 : 0);

function sendQueue(res) {
  clearTimeout(res.offloadTimer);
  waiters.delete(res);
  json(res, 200, { version, queue: queue.map(view) });
}

function broadcast() {
  version++;
  const data = `data: ${JSON.stringify({ queue: queue.map(view) })}\n\n`;
  for (const c of clients) c.write(data);
  for (const w of [...waiters]) sendQueue(w);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', d => (s += d));
    req.on('end', () => {
      try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); }
    });
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function oneLine(s, max) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

const server = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(readFileSync(UI));
    return;
  }

  if (req.method === 'GET' && pathname === '/health') {
    return json(res, 200, { ok: true, clients: consoles(), waiting: queue.length });
  }

  // Long-poll for panes that can't hold an event stream: answers at once when
  // the queue changed since `v`, else on the next change or after 15 s.
  if (req.method === 'GET' && pathname === '/queue') {
    lastPollAt = Date.now();
    if (searchParams.get('v') !== String(version)) return sendQueue(res);
    waiters.add(res);
    res.offloadTimer = setTimeout(() => sendQueue(res), 15000);
    res.on('close', () => { clearTimeout(res.offloadTimer); waiters.delete(res); lastPollAt = Date.now(); });
    return;
  }

  if (req.method === 'GET' && pathname === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ queue: queue.map(view) })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    res.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  // Long-poll: the response is held open until the human answers.
  if (req.method === 'POST' && pathname === '/ask') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const question = oneLine(body.question, 300);
    const options = Array.isArray(body.options) && body.options.length === 2
      ? body.options.map(o => oneLine(o, 40))
      : ['yes', 'no'];
    if (!question) return json(res, 400, { error: 'question is required' });
    if (body.requireClient && consoles() === 0) return json(res, 409, { error: 'no console open' });

    const item = {
      id: randomUUID(),
      question,
      options,
      context: oneLine(body.context, 200),
      source: oneLine(body.source, 60),
      kind: body.kind === 'permission' ? 'permission' : 'ask',
      revision: Number.isInteger(body.revision) && body.revision > 0 ? body.revision : 0,
      createdAt: Date.now(),
      res,
    };
    queue.push(item);
    broadcast();
    // The asker gave up (agent interrupted, hook timed out): drop the question.
    res.on('close', () => {
      const i = queue.indexOf(item);
      if (i !== -1) { queue.splice(i, 1); broadcast(); }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/answer') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const i = queue.findIndex(q => q.id === body.id);
    if (i === -1) return json(res, 404, { error: 'gone' });
    // 0 and 1 pick an option; 2 rejects both, and the asker is expected to reword and re-ask.
    const index = [0, 1, 2].includes(body.index) ? body.index : 0;
    const [item] = queue.splice(i, 1);
    json(item.res, 200, index === 2
      ? { answer: null, index, rejected: true }
      : { answer: item.options[index], index });
    broadcast();
    return json(res, 200, { ok: true });
  }

  json(res, 404, { error: 'not found' });
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') process.exit(0); // already running
  throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`offload console → http://localhost:${PORT}`);
});
