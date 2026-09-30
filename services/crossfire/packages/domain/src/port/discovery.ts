import type { Result } from '@crossfire/kernel/result';
import type { Page, PageRequest } from './directory.js';
import type { Permission, Role } from '../authorization/types.js';
export type PrincipalSummary = { principalId: string; matrixUserId: string; kind: 'human' | 'agent'; displayName: string; ownerId: string; ownerMatrixId: string };
export type PrincipalIdentity = { matrixUserId: string; kind: 'human' | 'agent' | 'unknown'; ownerMatrixId: string | null };
export type DiscoveryFilter = PageRequest & { kind: 'all' | 'human' | 'agent'; search: string; excludeId?: string };
export type DiscoveryRepository = {
  identities(matrixUserIds: string[]): Result<PrincipalIdentity[]>;
  selected(principalIds: string[]): Result<PrincipalSummary[]>;
  principals(filter: DiscoveryFilter): Result<Page<PrincipalSummary>>;
  roles(kind: 'human' | 'agent'): Result<Role[]>;
  permissions(): Result<Permission[]>;
};
