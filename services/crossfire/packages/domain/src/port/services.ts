import type { Repositories } from './repositories.js';
import type { DirectoryRepository } from './directory.js';
import type { CollectionRepository } from './collection.js';
import type { UnitOfWork } from './unit-of-work.js';
import type { MatrixAuthority } from './matrix-authority.js';
import type { ListenerReadRepository } from './listener-read.js';
import type { DiscoveryRepository } from './discovery.js';
import type { RoomGrantReadRepository } from './room-grant-read.js';
import type { RoomOperations } from './room-operations.js';
import type { ScheduleCalculator } from './schedule.js';
export type Services = {
  repositories: Repositories;
  directory: DirectoryRepository;
  collection: CollectionRepository;
  listenerRead: ListenerReadRepository;
  discovery: DiscoveryRepository;
  roomGrantRead: RoomGrantReadRepository;
  roomOperations: RoomOperations;
  schedule: ScheduleCalculator;
  unitOfWork: UnitOfWork;
  matrix: MatrixAuthority;
  clock: { now(): number };
  identity: { id(): string; secret(): string; verificationCode(): string; hash(value: string): string; matches(value: string, digest: string): boolean };
  instance: { serverName: string; publicOrigin: string; serviceMatrixId: string };
};
export type Actor = { principalId: string; kind: 'human' | 'agent'; authentication?:
  { kind: 'management'; sessionHash: string } | { kind: 'native'; matrixUserId: string } };
