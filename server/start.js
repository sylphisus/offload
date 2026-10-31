#!/usr/bin/env node
// Starts the offload daemon in the background if it isn't running, then exits.
import { ensureServer } from './client.js';

await ensureServer();
