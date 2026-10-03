export function listenerStop(message: string): Error & { listenerStop: true } {
  return Object.assign(new Error(message), { listenerStop: true as const });
}

export function isListenerStop(reason: unknown): boolean {
  return reason instanceof Error && 'listenerStop' in reason && reason.listenerStop === true;
}
