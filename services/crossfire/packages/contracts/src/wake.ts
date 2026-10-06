export const WAKE_POLICIES = ['selected', 'humans', 'everyone'] as const;
export type WakePolicy = typeof WAKE_POLICIES[number];
export const WAKE_LABELS: Record<WakePolicy, string> = {
  humans: 'All people + selected agents',
  everyone: 'All humans and their agents',
  selected: 'Selected people & agents',
};
export function wakePolicy(value: unknown): value is WakePolicy {
  return typeof value === 'string' && WAKE_POLICIES.some(policy => policy === value);
}
