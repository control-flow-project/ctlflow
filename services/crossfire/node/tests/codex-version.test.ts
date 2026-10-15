import assert from 'node:assert/strict';
import test from 'node:test';
import { localEndpoint } from '@ctlflow/crossfire-adapter-codex/protocol';

test('the runtime connection accepts only explicit authenticated loopback WS destinations', () => {
  for (const endpoint of ['ws://127.0.0.1:1234', 'ws://localhost:1234', 'wss://[::1]:1234']) {
    assert.equal(localEndpoint(endpoint), endpoint + '/');
  }
  for (const endpoint of ['stdio://', 'unix:///tmp/codex', 'ws://example.com:1234', 'ws://0.0.0.0:1234',
    'ws://user:secret@localhost:1234', 'ws://localhost:1234/path', 'ws://localhost:1234?token=secret', 'ws://localhost:1234#secret']) {
    assert.throws(() => localEndpoint(endpoint));
  }
});
