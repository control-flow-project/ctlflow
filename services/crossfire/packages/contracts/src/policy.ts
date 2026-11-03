export const DEFAULT_AGENT_INSTRUCTIONS = '';
export const AGENT_INSTRUCTIONS_MAX_BYTES = 8192;
export const POLICY_LIMITS = {
  maxOwnerAgents: { min: 1, max: 100 }, maxAgents: { min: 1, max: 1000 }, maxPending: { min: 1, max: 1000 },
  enrollmentSeconds: { min: 60, max: 3600 }, reconcileSeconds: { min: 30, max: 3600 },
  maxMessageBytes: { min: 4096, max: 4194304 },
  fleetIdleTimeoutSeconds: { min: 0, max: 604800 },
} as const;
export const HUMAN_SIGNUP = { usernameMax: 100, usernamePattern: '[a-z0-9][a-z0-9._=\\-]*', passwordMin: 12, passwordMax: 1024, labelMax: 100 } as const;
