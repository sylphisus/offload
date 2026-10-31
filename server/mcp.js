#!/usr/bin/env node
// Stdio MCP server exposing one tool, `ask`, which routes a binary question to
// the offload console and blocks until the human taps Z or X.
import readline from 'node:readline';
import path from 'node:path';
import { call, ensureServer, openConsole, CONSOLE_URL } from './client.js';

const INSTRUCTIONS = `The user answers decisions through the offload console: one line on screen, two choices, one keypress.
Whenever you need the user to decide something (approach A vs B, go ahead or not, which file, keep or drop), call \`ask\` instead of asking in prose.
Rules: one question per call; the question is a single line, ideally under 80 characters; exactly two short options (1-3 words each), the one you recommend first.
If a decision has more than two options, break it into a sequence of binary asks. Do not use \`ask\` for open-ended input (names, free text); ask those in chat.
The user can also reject both options. Then the framing was wrong: rethink it and call \`ask\` again with a reworded question or different options. Never re-send the same question.`;

const TOOLS = [{
  name: 'ask',
  description: 'Ask the user a binary decision. They see one line and answer with a single keypress: first option, second option, or neither. Returns the chosen option, or tells you both were rejected so you can reword and ask again.',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'One line, ideally under 80 characters.' },
      options: {
        type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2,
        description: 'Exactly two short labels, recommended first. Defaults to ["yes", "no"].',
      },
      context: { type: 'string', description: 'Optional one-line hint shown under the question.' },
    },
    required: ['question'],
  },
}];

const source = path.basename(process.cwd());
const pending = new Map(); // JSON-RPC id → abort()
let opened = false;
let rejections = 0; // consecutive "neither" answers; the next ask is shown as a retake

const send = msg => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });

async function ask(id, args) {
  const options = args.options ?? ['yes', 'no'];
  if (!args.question?.trim()) return text('question is required', true);
  if (!Array.isArray(options) || options.length !== 2) return text('options must be exactly two labels', true);

  const h = await ensureServer();
  if (h.clients === 0 && !opened) { opened = true; openConsole(); }

  const { promise, abort } = call('POST', '/ask', {
    question: args.question, options, context: args.context, source, kind: 'ask', revision: rejections,
  });
  pending.set(id, abort);
  try {
    const { status, body } = await promise;
    if (status !== 200) return text(`offload error: ${body.error}`, true);
    if (body.rejected) {
      rejections++;
      return text(`neither: the user rejected both "${options[0]}" and "${options[1]}". Rethink the question, then call ask again with a reworded question or different options. Do not repeat this question.`);
    }
    rejections = 0;
    return text(body.answer);
  } finally {
    pending.delete(id);
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'notifications/cancelled') return pending.get(params?.requestId)?.();
  if (id === undefined) return; // other notifications

  try {
    switch (method) {
      case 'initialize':
        return send({ id, result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'offload', version: '0.1.0' },
          instructions: INSTRUCTIONS,
        } });
      case 'ping':
        return send({ id, result: {} });
      case 'tools/list':
        return send({ id, result: { tools: TOOLS } });
      case 'tools/call':
        if (params?.name !== 'ask') return send({ id, result: text(`unknown tool ${params?.name}`, true) });
        return send({ id, result: await ask(id, params.arguments ?? {}) });
      default:
        return send({ id, error: { code: -32601, message: `method not found: ${method}` } });
    }
  } catch (e) {
    send({ id, result: text(`offload unavailable (${e.message}). Ask in chat instead; console is ${CONSOLE_URL}`, true) });
  }
}

readline.createInterface({ input: process.stdin }).on('line', line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  handle(msg);
});
