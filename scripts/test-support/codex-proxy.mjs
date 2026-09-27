#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';

if (process.argv[2] !== 'app-server' || process.argv[3] !== 'proxy') process.exit(2);
const config = JSON.parse(readFileSync(new URL('codex.json', import.meta.url), 'utf8'));
const socket = createConnection({ host: '127.0.0.1', port: config.port });
socket.on('error', () => process.exit(1));
socket.on('close', () => process.exit(0));
process.stdin.pipe(socket).pipe(process.stdout);
