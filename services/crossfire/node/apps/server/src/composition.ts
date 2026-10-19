import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicationStore } from '@ctlflow/crossfire-adapter-filesystem/publication/store';
import { createPublicationRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/publication/index';
import { openStore } from '@ctlflow/crossfire-adapter-sqlite/open-store';
import { createRepositories } from '@ctlflow/crossfire-adapter-sqlite/create-repositories';
import { createDirectoryRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/directory/index';
import { createCollectionRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/collection/index';
import { createListenerReadRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/listener-read/index';
import { createDiscoveryRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/discovery/index';
import { createRoomGrantReadRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/room-grant-read/index';
import { createUnitOfWork } from '@ctlflow/crossfire-adapter-sqlite/unit-of-work';
import { createScheduleCalculator } from '@ctlflow/crossfire-adapter-schedule/create-calculator';
import { initializeInstance } from '@ctlflow/crossfire-domain/principal/register';
import { createRoomOperations } from '@ctlflow/crossfire-domain/room-access/create-operations';
import type { Services } from '@ctlflow/crossfire-domain/port/services';
import type { MessagingAuthority } from '@ctlflow/crossfire-domain/port/messaging';
import { publicationBudget, type Config } from './config.js';
import { createRuntimeRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/runtime/index';
import { createStatisticsRepository } from '@ctlflow/crossfire-adapter-sqlite/repository/statistics/index';
import { createLoggingRetention } from '@ctlflow/crossfire-adapter-sqlite/repository/logging/index';
import { loggingRetentionDays } from '@ctlflow/crossfire-kernel/logging';
import { createDiagnosticLog } from '@ctlflow/crossfire-adapter-filesystem/logging';
import type { DiagnosticLog } from '@ctlflow/crossfire-domain/port/logging';
import { configureBackend, type BackendFactory } from './messaging.js';
import type { MessagingHttpFactory } from './http/messaging.js';
export type Application = { services: Services; config: Config; diagnostics: DiagnosticLog; messagingHttp: MessagingHttpFactory; close(): void };
export function createApplication(path: string, config: Config, options: { now?: () => number; backend?: BackendFactory; publicationDirectory?: string; diagnostics?: DiagnosticLog } = {}): Application {
  const budget = publicationBudget(config.publicationBudget); if (!budget.ok) throw new Error(budget.error.message);
  const retention = loggingRetentionDays(config.loggingRetentionDays); if (!retention.ok) throw new Error(retention.error.message);
  const temporary = path === ':memory:' ? mkdtempSync(join(realpathSync(tmpdir()), 'crossfire-publications-')) : undefined;
  let acquiredStore: ReturnType<typeof createPublicationStore> | undefined;
  let acquiredDatabase: ReturnType<typeof openStore> | undefined;
  let acquiredMessaging: MessagingAuthority | undefined;
  let diagnostics: DiagnosticLog | undefined;
  let closed = false;
  function close() {
    if (closed) return; closed = true;
    try { acquiredMessaging?.close(); } finally {
      try { acquiredDatabase?.close(); } finally {
        try { acquiredStore?.close(); } finally { if (!options.diagnostics) diagnostics?.close(); if (temporary) rmSync(temporary, { recursive: true }); }
      }
    }
  }
  try {
    const store = acquiredStore = createPublicationStore(options.publicationDirectory ?? temporary ?? path + '.publications', budget.value.uploads);
    diagnostics = options.diagnostics ?? createDiagnosticLog(temporary ? join(temporary, 'logs') : path + '.logs', retention.value, options.now ?? Date.now);
    const database = acquiredDatabase = openStore(path);
    const backend = (options.backend ?? configureBackend)(config);
    const messaging = acquiredMessaging = backend.authority;
    function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
    const services: Services = {
      logging: createLoggingRetention(database, retention.value),
      publication: { repository: createPublicationRepository(database), store, budget: budget.value, get origin() { return config.contentOrigin; } },
      statistics: createStatisticsRepository(database),
      runtime: createRuntimeRepository(database),
      repositories: createRepositories(database), directory: createDirectoryRepository(database), collection: createCollectionRepository(database),
      listenerRead: createListenerReadRepository(database), discovery: createDiscoveryRepository(database), roomGrantRead: createRoomGrantReadRepository(database),
      unitOfWork: createUnitOfWork(database), roomOperations: createRoomOperations(), schedule: createScheduleCalculator(), messaging, clock: { now: options.now ?? Date.now },
      instance: { publicOrigin: config.publicOrigin },
      identity: { id: randomUUID, secret: () => randomBytes(32).toString('base64url'), verificationCode: () => randomBytes(6).toString('hex').toUpperCase(), hash,
        matches(value, digest) { const actual = Buffer.from(hash(value), 'hex'), expected = Buffer.from(digest, 'hex');
          return actual.length === expected.length && timingSafeEqual(actual, expected); } },
    };
    const initialized = initializeInstance(services, config.administrator);
    if (!initialized.ok) throw new Error(initialized.error.message);
    return { services, config, diagnostics, messagingHttp: backend.http(services), close };
  } catch (error) { close(); throw error; }
}
