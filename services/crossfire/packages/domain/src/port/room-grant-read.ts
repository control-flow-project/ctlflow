import type { Result } from '@crossfire/kernel/result';
import type { Page, PageRequest } from './directory.js';
import type { AgentRoomGrant, AgentRoomPermission, RoomGrantApplication } from '../room-access/types.js';
export type RoomGrantReadRepository = {
  page(agentId: string, page: PageRequest & { roomIds?: string[] }): Result<Page<AgentRoomGrant>>;
  applications(agentId: string, roomIds: string[]): Result<RoomGrantApplication[]>;
  permissions(agentId: string, roomIds: string[]): Result<AgentRoomPermission[]>;
};
