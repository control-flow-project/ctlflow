import { createContext, useContext, type ReactNode } from 'react';
import type { Parsed } from '@ctlflow/crossfire-contracts/schema/validation';
import type { messagingBackend } from '@ctlflow/crossfire-contracts/schema/response';
import { operations, useResource } from './api.js';

type Description = Parsed<typeof messagingBackend>;
const Backend = createContext<Description | null>(null);
export function useBackend(): Description {
  const backend = useContext(Backend);
  if (!backend) throw new Error('Messaging backend provider required');
  return backend;
}
export function MessagingBackend({ children }: { children: ReactNode }) {
  const resource = useResource(operations.messagingBackend, {});
  if (!resource.result) return <main className="loading" role="status">Loading messaging configuration…</main>;
  if (!resource.result.ok) return <main className="loading"><p role="alert">{resource.result.error.message}</p><button onClick={resource.refresh}>Retry</button></main>;
  return <Backend.Provider value={resource.result.value.data}>{children}</Backend.Provider>;
}
export function ChatLink({ className }: { className?: string }) {
  const backend = useBackend();
  return <a className={className} href={backend.chatUrl}>Open {backend.label} →</a>;
}
