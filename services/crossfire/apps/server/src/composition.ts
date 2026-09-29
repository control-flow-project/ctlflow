import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { openStore } from '@crossfire/adapter-sqlite/open-store';
import { createRepositories } from '@crossfire/adapter-sqlite/create-repositories';
import { createDirectoryRepository } from '@crossfire/adapter-sqlite/repository/directory/index';
import { createCollectionRepository } from '@crossfire/adapter-sqlite/repository/collection/index';
import { createListenerReadRepository } from '@crossfire/adapter-sqlite/repository/listener-read/index';
import { createDiscoveryRepository } from '@crossfire/adapter-sqlite/repository/discovery/index';
import { createRoomGrantReadRepository } from '@crossfire/adapter-sqlite/repository/room-grant-read/index';
import { createUnitOfWork } from '@crossfire/adapter-sqlite/unit-of-work';
import { createMatrixAuthority } from '@crossfire/adapter-matrix/create-authority';
import { initializeInstance } from '@crossfire/domain/principal/register';
import type { Services } from '@crossfire/domain/port/services';
import type { MatrixAuthority } from '@crossfire/domain/port/matrix-authority';
import { serviceUser, type Config } from './config.js';
export type Application = { services: Services; config: Config; close(): void };
export function createApplication(path: string, config: Config, options: { now?: () => number; matrix?: MatrixAuthority } = {}): Application {
  const database = openStore(path);
  const matrix = options.matrix ?? createMatrixAuthority({ ...config, serviceMatrixId: serviceUser(config) });
  function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  const services: Services = {
    repositories: createRepositories(database), directory: createDirectoryRepository(database), collection: createCollectionRepository(database),
    listenerRead: createListenerReadRepository(database), discovery: createDiscoveryRepository(database), roomGrantRead: createRoomGrantReadRepository(database),
    unitOfWork: createUnitOfWork(database), matrix, clock: { now: options.now ?? Date.now },
    instance: { serverName: config.serverName, publicOrigin: config.publicOrigin, serviceMatrixId: serviceUser(config) },
    identity: { id: randomUUID, secret: () => randomBytes(32).toString('base64url'), verificationCode: () => randomBytes(6).toString('hex').toUpperCase(), hash,
      matches(value, digest) { const actual = Buffer.from(hash(value), 'hex'), expected = Buffer.from(digest, 'hex');
        return actual.length === expected.length && timingSafeEqual(actual, expected); } },
  };
  const initialized = initializeInstance(services, config.administrator);
  if (!initialized.ok) { matrix.close(); database.close(); throw new Error(initialized.error.message); }
  return { services, config, close() { matrix.close(); database.close(); } };
}
