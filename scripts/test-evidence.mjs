import { closeSync, openSync, writeSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

export function testEvidence(file, limits = {}) {
  const maximum = limits.logBytes ?? 16 * 1024 * 1024, tailBytes = limits.tailBytes ?? 64 * 1024, lineBytes = limits.lineBytes ?? 64 * 1024;
  if (![maximum, tailBytes, lineBytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Test evidence requires positive finite byte limits');
  const descriptor = openSync(file, 'wx', 0o600), counters = {}, streams = new Map();
  let bytes = 0, retainedBytes = 0, tail = Buffer.alloc(0), closed = false, invalidCounters = false;
  function line(value) {
    const matched = /^ℹ (tests|fail|cancelled|skipped|todo) (\d+)\r?$/u.exec(value);
    if (!matched) return;
    const count = Number(matched[2]);
    if (!Number.isSafeInteger(count) || Object.hasOwn(counters, matched[1])) invalidCounters = true;
    else counters[matched[1]] = count;
  }
  function decode(state, text) {
    for (const part of text.split(/(?<=\n)/u)) {
      const newline = part.endsWith('\n');
      if (!state.overflow) {
        state.partial += part;
        if (Buffer.byteLength(state.partial) > lineBytes) { state.partial = ''; state.overflow = true; }
      }
      if (newline) {
        if (!state.overflow) line(state.partial.slice(0, -1));
        state.partial = ''; state.overflow = false;
      }
    }
  }
  return {
    append(stream, input) {
      if (closed) throw new Error('Test evidence is already closed');
      const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input);
      bytes += chunk.length;
      const remaining = Math.min(chunk.length, maximum - retainedBytes);
      if (remaining > 0) { writeSync(descriptor, chunk.subarray(0, remaining)); retainedBytes += remaining; }
      tail = chunk.length >= tailBytes ? Buffer.from(chunk.subarray(chunk.length - tailBytes))
        : Buffer.concat([tail.subarray(Math.max(0, tail.length + chunk.length - tailBytes)), chunk]);
      let state = streams.get(stream);
      if (!state) { state = { decoder: new StringDecoder('utf8'), partial: '', overflow: false }; streams.set(stream, state); }
      decode(state, state.decoder.write(chunk));
    },
    finish() {
      if (closed) throw new Error('Test evidence is already closed');
      for (const state of streams.values()) {
        decode(state, state.decoder.end());
        if (!state.overflow && state.partial) line(state.partial);
      }
      const truncatedBytes = bytes - retainedBytes;
      if (truncatedBytes) writeSync(descriptor, '\n[Evidence byte limit reached; omitted ' + truncatedBytes + ' bytes. Summary counters parsed from complete streams.]\n');
      closeSync(descriptor); closed = true;
      const complete = !invalidCounters && ['tests', 'fail', 'cancelled', 'skipped', 'todo'].every(key => Object.hasOwn(counters, key));
      return { tests: counters.tests ?? 0, failed: counters.fail ?? 0, cancelled: counters.cancelled ?? 0,
        skipped: counters.skipped ?? 0, todo: counters.todo ?? 0,
        complete, bytes, retainedBytes, truncatedBytes, tail: tail.toString('utf8') };
    },
  };
}
