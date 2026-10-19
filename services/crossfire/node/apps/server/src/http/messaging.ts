import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Result } from '@ctlflow/crossfire-kernel/result';

export type MessagingHttp = (request: IncomingMessage, response: ServerResponse, url: URL, requestId: string) => Promise<boolean>;
export type MessagingHttpFactory = (presentation: Record<string, unknown>, admit: (request: IncomingMessage) => Result<void>) => MessagingHttp;
