export const WAKE_POLICIES = ['nobody', 'owner', 'owner-agents', 'humans', 'everyone'] as const;
export type WakePolicy = typeof WAKE_POLICIES[number];
export const WAKE_LABELS: Record<WakePolicy, string> = {
  nobody: 'Nobody',
  owner: 'Owner only',
  'owner-agents': 'Owner + owner’s agents',
  humans: 'Owner + owner’s agents + other humans',
  everyone: 'All humans and their agents',
};
export function wakePolicy(value: unknown): value is WakePolicy {
  return typeof value === 'string' && WAKE_POLICIES.some(policy => policy === value);
}
export function expandsWake(previous: WakePolicy, next: WakePolicy): boolean {
  return WAKE_POLICIES.indexOf(next) > WAKE_POLICIES.indexOf(previous);
}
