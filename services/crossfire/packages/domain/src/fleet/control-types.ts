import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { Page, PageRequest } from '../port/directory.js';

export const CONTROLLER_LEASE_MS = 30_000;
export const FLEET_MESSAGE_LIFETIME_MS = 600_000;
export const MAX_FLEET_MESSAGE_BYTES = 16_384;
export type FleetConnection = { fleetId: string; connectionId: string; credentialId: string; lastSeenAt: number; expiresAt: number; closedAt: number | null };
export type FleetMessage = { id: string; fleetId: string; authorPrincipalId: string | null; authorCredentialId: string | null; body: string; createdAt: number; expiresAt: number };
export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'skipped';
export type FleetMessageDelivery = { messageId: string; agentId: string; status: DeliveryStatus; completedAt: number | null; errorMessage: string | null };
export type FleetConnectionView = { status: 'online' | 'offline'; lastSeenAt: number | null };
export type FleetMessageCommand = { messageId: string; fleetId: string; body: string; createdAt: number; expiresAt: number;
  sender: { kind: 'human' | 'controller'; matrixUserId: string | null }; agentIds: string[] };
export type FleetControlView = { fleetId: string; revision: number; deliveryEnabled: boolean; connection: FleetConnectionView };
export type FleetControlSnapshot = FleetControlView & { agentIds: string[]; messages: FleetMessageCommand[]; runtimeOperations: import('./runtime-types.js').RuntimeOperationView[] };
export type FleetConnectionRepository = {
  find(fleetId: string): Result<FleetConnection | null>;
  findMany(fleetIds: string[]): Result<FleetConnection[]>;
  save(connection: FleetConnection): Result<void>;
};
export type FleetMessageRepository = {
  find(id: string): Result<FleetMessage | null>;
  insert(message: FleetMessage): Result<void>;
  page(fleetId: string, page: PageRequest): Result<Page<FleetMessage>>;
};
export type FleetMessageDeliveryRepository = {
  pendingForAgent(agentId: string, now: number): Result<boolean>;
  find(messageId: string, agentId: string): Result<FleetMessageDelivery | null>;
  forMessages(messageIds: string[]): Result<FleetMessageDelivery[]>;
  insert(delivery: FleetMessageDelivery): Result<void>;
  update(delivery: FleetMessageDelivery): Result<void>;
  pending(fleetId: string, now: number): Result<string | null>;
  pendingCount(fleetId: string, now: number): Result<number>;
};
