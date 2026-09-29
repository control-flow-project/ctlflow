export const WAKE_POLICIES = ['nobody', 'owner', 'owner-agents', 'humans', 'everyone', 'selected'] as const;
export type WakePolicy = typeof WAKE_POLICIES[number];
export const WAKE_LABELS: Record<WakePolicy, string> = {
  nobody: 'Nobody',
  owner: 'Owner only',
  'owner-agents': 'Owner + owner’s agents',
  humans: 'Owner + owner’s agents + other humans',
  everyone: 'All humans and their agents',
  selected: 'Selected people and agents',
};
export function wakePolicy(value: unknown): value is WakePolicy {
  return typeof value === 'string' && WAKE_POLICIES.some(policy => policy === value);
}
export type WakeAuthor = { id: string; label: string; kind: 'human' | 'agent'; owner: string };

export function resolveWake(policy: WakePolicy, selected: readonly string[], owner: string, self: string, authors: readonly WakeAuthor[]): string[] {
  const choices = new Set(selected);
  return authors.filter(author => author.id !== self && (policy === 'selected' ? choices.has(author.id)
    : policy === 'everyone' || policy !== 'nobody' && (author.id === owner
      || (policy === 'owner-agents' || policy === 'humans') && author.owner === owner
      || policy === 'humans' && author.kind === 'human'))).map(author => author.id).sort();
}
