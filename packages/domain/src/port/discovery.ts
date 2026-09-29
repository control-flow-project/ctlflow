import type { Result } from '../../../kernel/src/result.js';
import type { Page, PageRequest } from './directory.js';
import type { Permission, Role } from '../authorization/types.js';
export type PrincipalSummary = { principalId: string; matrixUserId: string; kind: 'human' | 'agent'; displayName: string; ownerId: string; ownerMatrixId: string };
export type DiscoveryFilter = PageRequest & { kind: 'all' | 'human' | 'agent'; search: string; excludeId?: string };
export type DiscoveryRepository = {
  principals(filter: DiscoveryFilter): Result<Page<PrincipalSummary>>;
  roles(kind: 'human' | 'agent'): Result<Role[]>;
  permissions(): Result<Permission[]>;
};
