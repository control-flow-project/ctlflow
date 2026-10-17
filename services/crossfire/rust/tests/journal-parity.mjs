import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { acquireFileLock } from '../../node/packages/adapter-filesystem/dist/lock.js';
import { deliveryJournal } from '../../node/packages/adapter-runtime/dist/journal.js';
import * as check from '../../node/packages/contracts/dist/schema/validation.js';

const [binary] = process.argv.slice(2);
assert(binary && isAbsolute(binary), 'Use the compiled native journal proof');
const directory = mkdtempSync(join(tmpdir(), 'crossfire-native-journal-')); chmodSync(directory, 0o700);
const file = join(directory, 'input.json');
const parse = check.object({text:check.text(200),messageId:check.text(200),published:check.boolean});
const message = {text:'native message 😀',messageId:'message',published:true};
const native = (action, input) => execFileSync(binary, [action,file], {encoding:'utf8',input,timeout:10_000,maxBuffer:4096});
let assertions = 0;
let node;
try {
  native('prepare',JSON.stringify(message));
  node = deliveryJournal(file,'session',parse);
  assert.deepEqual(node.pending(),message); assertions++;
  node.complete(message,true); node.close();
  const read = JSON.parse(native('read'));
  assert.equal(read.pending,null); assert.equal(read.confirmed[0].messageId,'message'); assertions+=2;
  native('acknowledge');
  node = deliveryJournal(file,'session',parse);
  node.prepare(message); node.close();
  native('confirm');
  node = deliveryJournal(file,'session',parse);
  assert.equal(node.confirmed(message.text,message.messageId),true); assertions++;
  const held = spawn(binary,['lock',file],{stdio:['pipe','pipe','pipe']});
  let errors = ''; held.stderr.setEncoding('utf8'); held.stderr.on('data',chunk => {errors=(errors+chunk).slice(-4096);});
  const closed = new Promise((resolve,reject) => {held.once('close',code => resolve(code)); held.once('error',reject);});
  let heldTimeout = false;
  const heldTimer = setTimeout(() => {heldTimeout = true; held.kill('SIGKILL');},10_000);
  try {assert.equal(await closed,1,'Node ownership excludes the native process'); assert.equal(heldTimeout,false); assertions+=2;}
  finally {clearTimeout(heldTimer); held.kill('SIGKILL'); await closed;}
  node.close();
  const owner = spawn(binary,['lock',file],{stdio:['pipe','pipe','pipe']});
  const timer = setTimeout(() => owner.kill('SIGKILL'),10_000);
  const ended = new Promise((resolve,reject) => {owner.once('close',code => resolve(code)); owner.once('error',reject);});
  try {
    await new Promise((resolve,reject) => {
      let output = ''; owner.stdout.setEncoding('utf8');
      owner.stdout.on('data',chunk => {output += chunk; if(output === 'owned\n') resolve(); else if(output.length > 128) reject(new Error('Unexpected native ownership response'));});
      owner.once('error',reject); void ended.then(() => {if(output !== 'owned\n') reject(new Error('Native owner ended before readiness'));});
    });
    let blocked = false, unexpected;
    try {unexpected = acquireFileLock(file);} catch(error) {blocked = error instanceof Error && /already owns/u.test(error.message);}
    finally {unexpected?.();}
    assert.equal(blocked,true,'Native ownership excludes the Node process'); assertions++;
    owner.stdin.end('x'); assert.equal(await ended,0); assertions++;
  } finally {clearTimeout(timer); owner.kill('SIGKILL'); await ended;}
  const release = acquireFileLock(file); release(); assertions++;
  console.log(JSON.stringify({status:'passed',assertions,scope:'bidirectional native delivery journal and real cross-process SQLite ownership lock; no schema created'}));
} finally {node?.close(); rmSync(directory,{recursive:true,force:true});}
