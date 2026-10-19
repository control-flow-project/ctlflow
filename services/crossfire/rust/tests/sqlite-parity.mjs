import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { databaseIdentity, foreignKeyViolations, integrityResults } from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { migrationQuery, migrationRows } from '../../dist/tests/support/migration-data.js';
import { createRepositories } from '@ctlflow/crossfire-adapter-sqlite/create-repositories';
import { createDirectoryRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/directory/index';
import { createRuntimeRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/runtime/index';
import { createStatisticsRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/statistics/index';

const [identityBinary, activityBinary] = process.argv.slice(2);
assert(identityBinary && activityBinary && process.argv.length === 4, 'Provide both compiled Rust parity executables');
const template = process.env.CROSSFIRE_TEST_DATABASE_TEMPLATE;
assert(template, 'Provide the shared Knex-prepared database template');
const directory = mkdtempSync(join(tmpdir(), 'crossfire-rust-sqlite-parity-'));
chmodSync(directory, 0o700);
const path = join(directory, 'management.sqlite');
copyFileSync(template, path); chmodSync(path, 0o600);

function value(result) { assert(result.ok, result.ok ? undefined : JSON.stringify(result.error)); return result.value; }
function native(binary, ...arguments_) {
  assert.equal(readFileSync(binary).subarray(0, 4).toString('hex'), '7f454c46', 'Native proof must execute an ELF binary');
  return JSON.parse(execFileSync(resolve(binary), arguments_, {encoding:'utf8', timeout:30_000, maxBuffer:1_048_576}).trim());
}
function schema(database) {
  assert.deepEqual(databaseIdentity(database), {application:1129465426, version:1});
  assert.deepEqual(foreignKeyViolations(database), []);
  assert.deepEqual(integrityResults(database), [{integrity_check:'ok'}]);
  return migrationRows(database, migrationQuery('sqlite_schema').select('type', 'name', 'tbl_name', 'sql')
    .where('name', 'not like', 'sqlite_%').orderBy(['type', 'name']));
}

let database;
try {
  database = new Database(path, {fileMustExist:true}); database.pragma('foreign_keys=ON');
  const before = schema(database);
  database.close(); database = null;
  const ownerId = randomUUID(); const rustIdentity = native(identityBinary, 'write', path, ownerId);
  assert.equal(rustIdentity.id, ownerId); assert.equal(rustIdentity.version, 1);
  database = new Database(path, {fileMustExist:true}); database.pragma('foreign_keys=ON');
  const repositories = createRepositories(database), directoryReader = createDirectoryRepository(database), runtime = createRuntimeRepository(database), statistics = createStatisticsRepository(database);
  const member = value(directoryReader.member(ownerId)); assert(member);
  assert.equal(member.member.displayName, 'Portable native record');
  value(repositories.member.update({...member.member, displayName:'Node renamed this member'}));
  const now = 1_792_000_000_000, agentId = randomUUID(), fleetId = randomUUID(), runId = randomUUID(), decisionId = randomUUID();
  database.transaction(() => {
    value(repositories.principal.insert({id:agentId, backendUserId:'@agent:example.test', kind:'agent', status:'active', revision:0, createdAt:now}));
    value(repositories.agent.insert({principalId:agentId, principalKind:'agent', ownerId, wakeMode:'humans'}));
    value(repositories.principalRole.insert({principalId:agentId, principalKind:'agent', roleCode:'agent', assignedByMemberId:ownerId, assignedAt:now}));
    value(repositories.principalApplication.insert({principalId:agentId, appliedRevision:null, appliedIntentHash:null, appliedStatus:null, nativeDisplayName:null,
      lastAttemptAt:null, lastSuccessAt:null, nextCheckAt:now, errorCode:null, errorMessage:null}));
    value(repositories.fleet.insert({id:fleetId, ownerId, fleetKey:'parity', archivedAt:null, deliveryEnabled:true, label:'Parity', controllerName:'Parity', revision:0, createdAt:now, updatedAt:now}));
    value(repositories.fleetInstance.insert({ownerId, fleetKey:'parity', instanceKey:'agent', agentId, retiredAt:null}));
    value(repositories.agentName.insert({name:'parity-agent', agentId, requestId:null, instanceKey:null}));
    const credentialId = randomUUID(), connectionId = randomUUID();
    value(repositories.fleetCredential.insert({id:credentialId, fleetId, secretHash:createHash('sha256').update('fixture-controller').digest('hex'), createdAt:now, revokedAt:null}));
    value(repositories.fleetConnection.save({fleetId, credentialId, connectionId, lastSeenAt:now, expiresAt:now + 30_000, closedAt:null}));
    value(repositories.listenerRun.insert({id:runId, agentId, controller:{fleetId,connectionId,credentialId}, release:'parity', startedAt:now, lastSeenAt:now, activeMs:0,
      messagesDelivered:0, stoppedAt:now, disconnectRequestedAt:null}));
    value(runtime.insertDecision({id:decisionId, agentId, runId, runtime:'codex', sessionId:'native-session', requestId:randomUUID(), turnId:'node-turn', itemId:'node-item',
      kind:'question', action:'input', review:'Native Node review 🦉', blocking:true, expiresAt:null, status:'pending', createdAt:now,
      questions:[{id:'question',title:'Proceed',prompt:'Proceed?',secret:false,allowText:false,options:[{id:'yes',label:'Yes',description:'Proceed'}]}]}));
    value(runtime.saveObservation(agentId, {runId, sessionId:'native-session', roomId:null, runtime:'codex', state:'idle', observedAt:now,
      lastActivityAt:now, historyAvailable:true, historyMode:'shared', maxInputBytes:65536, errorMessage:null,
      settings:[{name:'model',configured:'fixture-model',effective:'fixture-model'}]}));
    value(statistics.record(agentId, runId, {sequence:1, startedAt:now, endedAt:now, dropped:0,
      flows:[{roomId:'!room:example.test',senderBackendUserId:'@owner:example.test',messageType:'m.text',observed:2,delivered:1,contentBytes:120,deliveredBytes:60,attachmentBytes:200,largestBytes:80}],
      usage:[{runtime:'codex',sessionId:'native-session',tokens:{input:100,cachedInput:40,cacheWriteInput:null,output:20,reasoningOutput:10,total:120}}]}, now));
  })();
  database.close(); database = null;
  const first = native(activityBinary, 'inspect', path, agentId, runId, decisionId);
  assert.equal(first.decisions[0].review, 'Native Node review 🦉'); assert.equal(first.observations[0].state, 'idle'); assert.equal(first.statistics.observed, 2);
  const second = native(activityBinary, 'record', path, agentId, runId, decisionId);
  assert.equal(second.observations[0].state, 'waiting-answer'); assert.equal(second.statistics.observed, 5); assert.equal(second.statistics.tokens.input, 50);
  database = new Database(path, {fileMustExist:true}); database.pragma('foreign_keys=ON');
  const afterRuntime = createRuntimeRepository(database), afterStatistics = createStatisticsRepository(database), afterDirectory = createDirectoryRepository(database);
  assert.equal(value(afterDirectory.member(ownerId)).member.displayName, 'Node renamed this member');
  assert.equal(value(afterRuntime.decision(decisionId)).status, 'answered');
  assert.deepEqual(value(afterRuntime.answers(decisionId)), [{questionId:'question',optionId:'yes',text:null}]);
  const nativeDecisions = value(afterRuntime.decisions(agentId, 1, 20, null)); assert.equal(nativeDecisions.totalItems, 2);
  const created = value(afterRuntime.decision(nativeDecisions.items[0].id)); assert.equal(created.review, 'Native Rust review 🦉'); assert.equal(created.questions[0].options[0].id, 'yes');
  const measured = value(afterStatistics.read([agentId], 0, 1, 100));
  assert.equal(measured.totals.observed, 5); assert.equal(measured.totals.contentBytes, 320); assert.equal(measured.totals.attachmentBytes, 600);
  assert.equal(measured.totals.largestBytes, 100); assert.equal(measured.tokens.input, 50); assert.equal(measured.tokens.cachedInput, 20); assert.equal(measured.tokens.reasoningOutput, 5);
  assert.equal(JSON.stringify(schema(database)) === JSON.stringify(before), true, 'Application reads/writes must not create or mutate schema or Knex metadata');
  console.log(JSON.stringify({status:'passed',directions:['Node→Rust','Rust→Node'],capabilities:['identity','roles','questions','answers','observations','settings','traffic','token-checkpoints'],schema:'unchanged'}));
} finally { database?.close(); rmSync(directory, {recursive:true, force:true}); }
