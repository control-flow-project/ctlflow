import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Result } from '@ctlflow/crossfire-kernel/result';

export type WebTransport = {
  readBody(request: IncomingMessage, maximum?: number): Promise<Result<unknown>>;
  readForm(request: IncomingMessage): Promise<Result<URLSearchParams>>;
  invitationCookie(request: IncomingMessage): { id: string; secret: string } | null;
  setInvitationCookie(response: ServerResponse, value: string | null): void;
};
