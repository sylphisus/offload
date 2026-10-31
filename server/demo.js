#!/usr/bin/env node
// Fire a batch of sample questions at the console so you can try it without an agent.
import { call, ensureServer, openConsole } from './client.js';

const QUESTIONS = [
  ['api', 'Use Postgres or SQLite for the job queue?', ['postgres', 'sqlite'], 'queue is ~200 jobs/day'],
  ['api', 'Tests pass. Commit to feature/auth?', ['commit', 'hold']],
  ['web', 'Rename `fetchUser` to `getUser` across 14 files?', ['rename', 'skip']],
  ['web', 'Lint fails on 3 legacy files. Fix them or ignore?', ['fix', 'ignore']],
  ['site', 'Keep the old landing page behind a flag?', ['keep', 'delete']],
  ['site', 'Ship the dark theme as default?', ['yes', 'no']],
  ['api', 'Retry flaky e2e once more or mark it skipped?', ['retry', 'skip']],
  ['web', 'Open the PR as draft?', ['draft', 'ready']],
];

const h = await ensureServer();
if (h.clients === 0) openConsole();

await Promise.all(QUESTIONS.map(async ([source, question, options, context], i) => {
  await new Promise(r => setTimeout(r, i * 150));
  // On "neither", a real agent would rethink; the demo just rewords and re-asks,
  // which puts the question at the back of the queue.
  for (let revision = 0; ; revision++) {
    const q = revision ? `Reworded (take ${revision + 1}): ${question}` : question;
    const { body } = await call('POST', '/ask', { source, question: q, options, context, revision }).promise;
    if (!body.rejected) { console.log(`${q}  →  ${body.answer}`); break; }
    console.log(`${q}  →  neither, re-asking`);
  }
}));
