import type { Result } from '@ctlflow/crossfire-kernel/result';
import type { JsonObject } from '@ctlflow/crossfire-kernel/json';
import type { BackendConfiguration, BackendAccount } from './messaging.js';

export type EventType = 'message' | 'membership' | 'name' | 'topic' | 'access' | 'join-policy' | 'history-policy'
  | 'encryption' | 'encrypted' | 'redaction' | 'migration' | 'other';
export type MessageAttachment = { id: string; name: string | null; mediaType: string | null; bytes: number | null };
export type MessageContent = { kind: 'text' | 'notice' | 'image' | 'file' | 'audio' | 'video' | 'location' | 'other';
  body: string | null; mentions: string[]; edited: boolean; control: boolean; attachments: MessageAttachment[]; attributes: JsonObject };
export type MessageEvent = { eventId: string; roomId: string; sender: string; type: EventType; content: MessageContent;
  subjectId: string | null; sentAt: number | null; omitted?: string[] };
export type EventFilter = { types?: EventType[]; senders?: string[] };
export type MessagePageRequest = { from?: string; to?: string; direction: 'forward' | 'backward'; limit: number; filter?: EventFilter };
export type MessagePage = { events: MessageEvent[]; start: string | null; end: string | null; requestedLimit: number };
export type RoomOrigin = { kind: 'unknown' | 'dm' | 'room'; name: string | null; alias: string | null };
export type RoomFeed = { events: MessageEvent[]; limited: boolean; previousCursor: string | null;
  notifications: JsonObject | null; readState: JsonObject[] };
export type MessageFeed = { cursor: string; rooms: Record<string, RoomFeed>; invitations: string[]; departedRooms: string[]; resetRooms: string[] };
export type MessagingClient = {
  identify(): Promise<string>;
  joinedRooms(): Promise<string[]>;
  joinedMembers(roomId: string): Promise<string[]>;
  synchronize(since?: string, timeoutMs?: number): Promise<MessageFeed>;
  history(roomId: string, request: MessagePageRequest): Promise<MessagePage>;
  event(roomId: string, eventId: string): Promise<MessageEvent>;
  roomState(roomId: string): Promise<JsonObject[]>;
  origins(userId: string, roomIds: readonly string[]): Promise<Record<string, RoomOrigin>>;
  acknowledge(roomId: string, eventId: string): Promise<void>;
  sendNotice(roomId: string, transactionId: string, body: string): Promise<void>;
  thinking(roomId: string, userId: string, enabled: boolean, timeoutMs: number): Promise<void>;
  verifyPrivateConversation(roomId: string, ownerId: string, agentId: string): Promise<Result<void>>;
  noticeFits(body: string): boolean;
  noticeChunks(body: string): string[];
};
export type MessagingTransport = (signal: AbortSignal, timeoutMs: number) => MessagingClient;
export type MessagingConnection = { transport: MessagingTransport; invitationRooms(signal: AbortSignal): Promise<readonly string[]> };
export type MessagingConnector = (configuration: BackendConfiguration, account: BackendAccount) => MessagingConnection;
