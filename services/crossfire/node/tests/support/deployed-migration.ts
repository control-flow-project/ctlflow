import type Database from 'better-sqlite3';
import { openTestStore } from './storage.js';
import { schema13Store } from './schema13.js';
import { restoreSchema14EnrollmentItems } from './schema14.js';
import { restoreSchema16Logging } from './schema16.js';

export function seedWakeHistory(database: Database.Database): void {
  database.exec(`
INSERT INTO principal VALUES('owner','@owner:test','human','active',7,12),('other','@other:test','human','active',0,12);
INSERT INTO member VALUES('owner','human','Private owner'),('other','human','Other');
INSERT INTO enrollment_request(controller_name,controller_credential_hash,fleet_key,id,owner_id,verification_code,claim_hash,roster_digest,status,revision,created_at,expires_at,decided_by_member_id,decided_at)
 VALUES('Computer','private-controller-hash','fleet','request','owner','CODE00000000','private-claim','digest','pending',0,12,600,NULL,NULL);
INSERT INTO enrollment_archive VALUES(NULL,NULL,NULL,'archive','owner','CODE00000001','archived-claim','retained-historical-digest','approved',1,12,600,'owner',14);
`);
  for (const mode of ['nobody', 'owner', 'owner-agents', 'humans', 'everyone', 'selected']) {
    const agentId = 'agent-' + mode;
    database.prepare("INSERT INTO principal VALUES(?,?,'agent','active',9,12)").run(agentId, '@' + agentId + ':test');
    database.prepare("INSERT INTO agent VALUES(?,'agent','owner',NULL,?)").run(agentId, mode);
    database.prepare('INSERT INTO agent_credential VALUES(?,?,?,12)').run(agentId, 'private-password-' + mode, 'private-token-' + mode);
    database.prepare('INSERT INTO agent_name VALUES(?,NULL,NULL,?)').run(mode, agentId);
    database.prepare("INSERT INTO enrollment_item VALUES(?,?,?,'existing',?,NULL)").run('request', mode, mode, agentId);
    database.prepare('INSERT INTO enrollment_item_policy VALUES(?,?,?,9)').run('request', mode, mode);
    database.prepare("INSERT INTO enrollment_archive_item VALUES(?,?,?,'existing',?,NULL)").run('archive', mode, mode, agentId);
    database.prepare('INSERT INTO enrollment_archive_policy VALUES(?,?,?,9)').run('archive', mode, mode);
    if (mode === 'selected') {
      database.prepare('INSERT INTO agent_wake_sender VALUES(?,?)').run(agentId, 'other');
      for (const prefix of ['item', 'archive']) database.prepare('INSERT INTO enrollment_' + prefix + '_wake_sender VALUES(?,?,?)').run(prefix === 'item' ? 'request' : 'archive', mode, 'other');
    }
  }
  database.exec(`
INSERT INTO fleet(id,owner_id,fleet_key,label,controller_name,archived_at,delivery_enabled,revision,created_at,updated_at)
 VALUES('fleet','owner','fleet','Private fleet','Computer',NULL,1,4,12,12);
INSERT INTO fleet_instance(owner_id,fleet_key,instance_key,agent_id,retired_at) VALUES('owner','fleet','selected','agent-selected',NULL);
INSERT INTO agent_room_grant VALUES('agent-selected','!matter:test','generation','owner','owner',NULL,'managed','reply',NULL,0,3,1,12);
INSERT INTO agent_room_permission VALUES('agent-selected','!matter:test','generation','room.agent.invite','agent_room','owner',12);
INSERT INTO enrollment_item_permission VALUES('request','selected','room.agent.invite','agent_room');
INSERT INTO enrollment_archive_permission VALUES('archive','selected','room.agent.invite','agent_room');
INSERT INTO enrollment_controller_metadata VALUES('request','zone','local');
`);
}

export function schema14Store(): Database.Database {
  const database = openTestStore();
  database.pragma('foreign_keys=ON'); restoreSchema14EnrollmentItems(database); restoreSchema16Logging(database);
  database.exec(`ALTER TABLE agent ADD COLUMN display_name_override TEXT;
    INSERT INTO principal VALUES('owner','@owner:test','human','active',4,1),('agent','@agent:test','agent','active',7,1);
    INSERT INTO member VALUES('owner','human','Owner');
    INSERT INTO agent(principal_id,principal_kind,owner_id,wake_mode) VALUES('agent','agent','owner','selected');
    INSERT INTO agent_credential VALUES('agent','private-password','private-token',1);
    INSERT INTO fleet VALUES(NULL,'fleet',1,'Fleet','Computer',2,1,'owner','fleet',1);
    INSERT INTO fleet_instance VALUES(NULL,'owner','fleet','saved','agent');
    INSERT INTO fleet_credential VALUES('partial','fleet','retained-private-hash',1,NULL);
    INSERT INTO enrollment_request VALUES('Computer','retained-private-hash','partial','owner','fleet','PARTIALCODE1','private-claim','roster','approved',1,1,100,'owner',2);
    INSERT INTO enrollment_request VALUES('Computer','pending-hash','pending','owner','fleet','PENDINGCODE1','pending-claim','pending-roster','pending',0,1,100,NULL,NULL);
    INSERT INTO enrollment_request VALUES('Computer','exact-hash','current','owner','fleet','CURRENTCODE1','exact-claim','exact-roster','pending',0,1,100,NULL,NULL);
    INSERT INTO enrollment_item VALUES('partial','saved','saved','existing','agent',NULL),('partial','collision','collision','failed',NULL,'name_collision'),
      ('pending','claimed','claimed','claimed',NULL,NULL),('pending','capacity','capacity','failed',NULL,'capacity'),('current','exact','exact','claimed',NULL,NULL);
    INSERT INTO agent_name VALUES('saved',NULL,NULL,'agent'),('claimed','pending','claimed',NULL),('exact','current','exact',NULL);
    INSERT INTO enrollment_item_policy VALUES('partial','saved','selected',7),('partial','collision','selected',NULL),
      ('pending','claimed','selected',NULL),('pending','capacity','selected',NULL),('current','exact','selected',NULL);
    INSERT INTO enrollment_item_permission VALUES('partial','saved','room.agent.invite','agent_room'),('pending','claimed','room.agent.invite','agent_room');
    INSERT INTO enrollment_item_wake_sender VALUES('partial','saved','owner',1),('pending','claimed','owner',0);
    INSERT INTO enrollment_controller_metadata VALUES('partial','label','Exact private historical metadata'),('pending','label','Pending metadata');`);
  database.pragma('user_version=14');
  return database;
}

export function deployedMigrationFixture(version: 13 | 14): Database.Database {
  if (version === 14) return schema14Store();
  const database = schema13Store(); seedWakeHistory(database); return database;
}
