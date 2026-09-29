import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { openStore } from '../../../packages/adapter-sqlite/src/open-store.js';
import { createRepositories } from '../../../packages/adapter-sqlite/src/create-repositories.js';
import { createDirectoryRepository } from '../../../packages/adapter-sqlite/src/repository/directory/index.js';
import { createCollectionRepository } from '../../../packages/adapter-sqlite/src/repository/collection/index.js';
import { createListenerReadRepository } from '../../../packages/adapter-sqlite/src/repository/listener-read/index.js';
import { createDiscoveryRepository } from '../../../packages/adapter-sqlite/src/repository/discovery/index.js';
import { createRoomGrantReadRepository } from '../../../packages/adapter-sqlite/src/repository/room-grant-read/index.js';
import { createUnitOfWork } from '../../../packages/adapter-sqlite/src/unit-of-work.js';
import { createMatrixAuthority } from '../../../packages/adapter-matrix/src/create-authority.js';
import { initializeInstance } from '../../../packages/domain/src/principal/register.js';
import type { Services } from '../../../packages/domain/src/port/services.js';
import type { MatrixAuthority } from '../../../packages/domain/src/port/matrix-authority.js';
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
