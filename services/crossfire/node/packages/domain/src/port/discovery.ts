import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { Page, PageRequest } from './directory.js';
import type { Permission, Role } from '../authorization/types.js';
export type PrincipalSummary = { principalId: string; backendUserId: string; kind: 'human' | 'agent'; displayName: string; ownerId: string; ownerBackendUserId: string };
export type PrincipalIdentity = { backendUserId: string; kind: 'human' | 'agent' | 'unknown'; ownerBackendUserId: string | null; displayName: string | null; ownerDisplayName: string | null };
export type DiscoveryFilter = PageRequest & { kind: 'all' | 'human' | 'agent'; search: string; excludeId?: string };
export type DiscoveryRepository = {
  identities(backendUserIds: string[]): Result<PrincipalIdentity[]>;
  selected(principalIds: string[]): Result<PrincipalSummary[]>;
  principals(filter: DiscoveryFilter): Result<Page<PrincipalSummary>>;
  roles(kind: 'human' | 'agent'): Result<Role[]>;
  permissions(): Result<Permission[]>;
};
