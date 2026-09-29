import type { Result } from '../../../kernel/src/result.js';
import type { Page, PageRequest } from './directory.js';
import type { AgentRoomGrant, AgentRoomPermission, RoomGrantApplication } from '../room-access/types.js';
export type RoomGrantReadRepository = {
  page(agentId: string, page: PageRequest): Result<Page<AgentRoomGrant>>;
  applications(agentId: string, roomIds: string[]): Result<RoomGrantApplication[]>;
  permissions(agentId: string, roomIds: string[]): Result<AgentRoomPermission[]>;
};
