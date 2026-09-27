import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { INSTANCES } from './instance.ts';
import { API, Matrix, readJson, readSettings, segment, type Account, type Event } from '../skills/conduit-chat/scripts/lib.ts';

const { values } = parseArgs({ options: {
  instance: { type: 'string' }, secondary: { type: 'string' }, 'skill-dir': { type: 'string' }, help: { type: 'boolean' },
} });
if (values.help || !values.instance || !values.secondary) {
  console.log('Usage: node scripts/verify.ts --instance FIRST --secondary SECOND [--skill-dir PATH]\n'
    + 'Both instances must be running and installed for the client account.\n'
    + 'Creates named verification accounts, rooms, files, and messages. Does not start agents.');
  process.exit(values.help ? 0 : 1);
}
assert.notEqual(values.instance, values.secondary, 'Verification needs two distinct instances');
const clientScript = `
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
const input=JSON.parse(readFileSync(0,'utf8'));
const skill=join(input.skill,'scripts');
const paths=JSON.parse(readFileSync(join(skill,'.client-paths.json'),'utf8'));
const CONFIG=process.env.CROSSFIRE_CLIENT_CONFIG_DIR || paths.config_dir;
const STATE=process.env.CROSSFIRE_CLIENT_STATE_DIR || paths.state_dir;
const {API,Matrix,MatrixError,segment}=await import(input.library);
const run='verify-'+Date.now().toString(36);
const a=run+'-a', b=run+'-b';
const dir=join(STATE,'verification',run);mkdirSync(dir,{recursive:true,mode:0o700});
const settings=id=>JSON.parse(readFileSync(join(CONFIG,'instances',id+'.json'),'utf8'));
const account=(id,agent)=>JSON.parse(readFileSync(join(CONFIG,'accounts',id,agent+'.json'),'utf8'));
function invoke(id,agent,...args){
 const result=spawnSync(process.execPath,[join(skill,'chat.mjs'),'--instance',id,'--agent',agent,...args],{encoding:'utf8',cwd:dir});
 if(result.status!==0)throw new Error(result.stderr || 'Client command failed');
 return JSON.parse(result.stdout);
}
function drain(id,agent,room,limit='100'){
 const events=[];
 for(let n=0;n<100;n++){
  const page=invoke(id,agent,'read','--room',room,'--limit',limit);events.push(...page.events);
  if(!page.more)return events;
 }
 throw new Error('Cursor did not drain');
}
const first=settings(input.instance), second=settings(input.secondary);
const firstDefault=first.rooms.find(room=>room.alias===first.default_room);
const secondDefault=second.rooms.find(room=>room.alias===second.default_room);
const extra=first.rooms.find(room=>room.alias!==first.default_room);
assert(extra,'The first verification instance needs at least two configured shared rooms');
assert.notEqual(first.homeserver,second.homeserver);
assert.notEqual(first.server_name,second.server_name);
for(const id of [input.instance,input.secondary])for(const agent of [a,b])invoke(id,agent,'init');
const aa=account(input.instance,a), ab=account(input.instance,b), ba=account(input.secondary,a);
assert.notEqual(aa.user_id,ba.user_id);
const client=new Matrix(first.homeserver,aa.access_token);
const catalog=invoke(input.instance,a,'rooms');
assert.equal(catalog.default_room,first.default_room);
for(const configured of first.rooms){
 const listed=catalog.rooms.find(room=>room.alias===configured.alias);
 assert.equal(listed.room_id,configured.room_id);assert.equal(listed.name,configured.name);assert.equal(listed.purpose,configured.purpose);
 for(const member of [aa.user_id,ab.user_id,first.observer])assert(listed.members.includes(member));
 await assert.rejects(client.post(API+'/rooms/'+segment(configured.room_id)+'/kick',{user_id:first.observer}),e=>e instanceof MatrixError&&e.status===403);
}
await assert.rejects(new Matrix(first.room_service).get('/_coord/rooms'),e=>e instanceof MatrixError&&e.status===401);
await assert.rejects(new Matrix(second.room_service,aa.access_token).get('/_coord/rooms'),e=>e instanceof MatrixError&&e.status===401);
await assert.rejects(client.post(API+'/createRoom',{preset:'private_chat'}),e=>e instanceof MatrixError && e.status===403);
const dm=invoke(input.instance,a,'send','--to',b,'--message','Verification: observer-inclusive direct conversation.');
const readB=invoke(input.instance,b,'read');
assert(readB.events.some(e=>e.event_id===dm.event_id));
const room=dm.room_id;
const members=(await client.get(API+'/rooms/'+segment(room)+'/joined_members')).joined;
assert.deepEqual(Object.keys(members).sort(),[aa.user_id,ab.user_id,first.observer].sort());
await assert.rejects(client.post(API+'/rooms/'+segment(room)+'/kick',{user_id:first.observer}),e=>e instanceof MatrixError && e.status===403);
await assert.rejects(client.put(API+'/rooms/'+segment(room)+'/state/m.room.power_levels',{users:{[aa.user_id]:100}}),e=>e instanceof MatrixError && e.status===403);
await assert.rejects(client.put(API+'/rooms/'+segment(room)+'/state/m.room.encryption',{algorithm:'m.megolm.v1.aes-sha2'}),e=>e instanceof MatrixError && e.status===403);
await assert.rejects(new Matrix(second.homeserver,aa.access_token).get(API+'/account/whoami'),e=>e instanceof MatrixError && e.status===401);
const reply=invoke(input.instance,b,'send','--to',a,'--message','Verification reply.');
assert.equal(reply.room_id,room);
const txn=randomUUID();
const one=invoke(input.instance,a,'send','--room',room,'--message','Idempotent delivery check.','--txn',txn);
const two=invoke(input.instance,a,'send','--room',room,'--message','Idempotent delivery check.','--txn',txn);
assert.equal(one.event_id,two.event_id);
const mainMessage=invoke(input.instance,a,'send','--message','Explicit default room check.');
assert.equal(mainMessage.room_id,firstDefault.room_id);
const routed=invoke(input.instance,a,'send','--room',extra.alias,'--message','Named shared-room delivery.');
assert.equal(routed.room_id,extra.room_id);
assert(invoke(input.instance,b,'history','--room','#'+extra.alias+':'+first.server_name).events.some(event=>event.event_id===routed.event_id));
assert(invoke(input.instance,b,'who','--room',extra.alias).members[first.observer]);
assert(!drain(input.instance,b,firstDefault.room_id).some(event=>event.event_id===routed.event_id));
assert(drain(input.instance,b,extra.alias).some(event=>event.event_id===routed.event_id));
assert.equal(drain(input.instance,b,extra.alias).length,0);
const invalid=spawnSync(process.execPath,[join(skill,'chat.mjs'),'--instance',input.instance,'--agent',a,'send','--room','unknown-room','--message','Must not be delivered'],{encoding:'utf8'});
assert.notEqual(invalid.status,0);assert(invalid.stderr.includes('Unknown room'));
const bytes=randomBytes(131113),file=join(dir,'attachment.bin'),download=join(dir,'received.bin');
writeFileSync(file,bytes,{mode:0o600});
const upload=invoke(input.instance,a,'upload',file,'--to',b);
const sharedUpload=invoke(input.instance,a,'upload',file,'--room',extra.alias);
assert.equal(sharedUpload.room_id,extra.room_id);
assert(invoke(input.instance,b,'history','--room',extra.alias).events.some(event=>event.event_id===sharedUpload.event_id));
const received=invoke(input.instance,b,'download',upload.mxc,download);
assert.equal(received.sha256,createHash('sha256').update(bytes).digest('hex'));
assert.deepEqual(readFileSync(download),bytes);
// A repeated download must preserve an existing destination.
const refused=spawnSync(process.execPath,[join(skill,'chat.mjs'),'--instance',input.instance,'--agent',b,'download',upload.mxc,download],{encoding:'utf8'});
assert.notEqual(refused.status,0);assert.deepEqual(readFileSync(download),bytes);
drain(input.instance,a,firstDefault.room_id);
const announcement='Cursor independence '+run;
const message=invoke(input.instance,b,'send','--message',announcement);
assert(drain(input.instance,a,firstDefault.room_id,'2').some(e=>e.event_id===message.event_id));
assert.equal(drain(input.instance,a,firstDefault.room_id).length,0);
assert(drain(input.instance,b,firstDefault.room_id,'2').some(e=>e.event_id===message.event_id));
assert(!drain(input.secondary,a,secondDefault.room_id).some(e=>e.event_id===message.event_id));
// Exercise the server's 100-event page boundary in the verification instance.
const secondClient=new Matrix(second.homeserver,ba.access_token);
const batch=[];
for(let n=0;n<107;n++){
 const sent=await secondClient.put(API+'/rooms/'+segment(secondDefault.room_id)+'/send/m.room.message/'+run+'-'+n,{msgtype:'m.notice',body:'Pagination verification '+run+' '+n});
 batch.push(sent.event_id);
}
const paged=drain(input.secondary,b,secondDefault.room_id,'100');
assert.deepEqual(paged.filter(e=>batch.includes(e.event_id)).map(e=>e.event_id),batch);
assert.equal(drain(input.secondary,b,secondDefault.room_id).length,0);
// The same logical agent name has independent cursor files in each instance.
assert.notEqual(join(STATE,input.instance,a),join(STATE,input.secondary,a));
console.log(JSON.stringify({ok:true,first:input.instance,second:input.secondary,room,dmEvent:dm.event_id,fileEvent:upload.event_id,
 checks:['HTTP messaging','observer joined','room creation denied','observer removal denied','permission changes denied','encryption denied','instance token isolation','same-name accounts isolated','DM reuse','idempotent send','binary file roundtrip','overwrite refused','independent cursors','107-event pagination','all configured rooms joined','room names and purposes','authenticated room catalog','default and alias routing','shared-room attachments','per-room unread positions','unknown room rejected']},null,2));
`;

const input = { ...values, skill: resolve(values['skill-dir'] ?? process.env.CROSSFIRE_SKILL_DIR
  ?? join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'skills/conduit-chat')),
  library: new URL('../skills/conduit-chat/scripts/lib.ts', import.meta.url).href };
const result = spawnSync(process.execPath, ['--input-type=module', '-e', clientScript],
  { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 1024 * 1024 });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr || 'Client verification failed');
const report = JSON.parse(result.stdout) as { room: string; dmEvent: string; fileEvent: string; checks: string[] };

for (const instance of [values.instance, values.secondary]) {
  const settings = readSettings(join(INSTANCES, instance, 'private/settings.json'));
  const web = new Matrix(settings.room_service);
  const configured = await web.get<{ default_server_config: { 'm.homeserver': { base_url: string } } }>('/config.json');
  assert.equal(configured.default_server_config['m.homeserver'].base_url, settings.homeserver);
  const html = await (await fetch(settings.room_service)).text();
  assert(html.includes('matrixchat'));
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => match[1]);
  assert(scripts.length > 0);
  for (const script of scripts) {
    const url = new URL(script, settings.room_service);
    assert.equal(url.origin, settings.room_service);
    const response = await fetch(url, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /javascript/);
  }
}
const settings = readSettings(join(INSTANCES, values.instance, 'private/settings.json'));
const observer = readJson<Account>(join(INSTANCES, values.instance, 'private/admin.json'));
const admin = new Matrix(settings.homeserver, observer.access_token);
for (const event of [report.dmEvent, report.fileEvent]) {
  const visible = await admin.get<Event>(`${API}/rooms/${segment(report.room)}/event/${segment(event)}`);
  assert.equal(visible.event_id, event);
}
report.checks.push('observer can read DM and attachment events', 'per-instance UI config', 'HTML and JavaScript assets');
console.log(JSON.stringify(report, null, 2));
