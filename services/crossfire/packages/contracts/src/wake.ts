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
