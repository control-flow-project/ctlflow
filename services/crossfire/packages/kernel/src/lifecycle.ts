export function listenerStop(message: string): Error & { listenerStop: true } {
  return Object.assign(new Error(message), { listenerStop: true as const });
}

export function isListenerStop(reason: unknown): boolean {
  return reason instanceof Error && 'listenerStop' in reason && reason.listenerStop === true;
}

export function canRecoverFailure(reason: unknown): boolean {
  if (isListenerStop(reason)) return false;
  if (!reason || typeof reason !== 'object' || !('code' in reason)) return true;
  if (reason instanceof DOMException) return reason.name === 'AbortError' || reason.name === 'TimeoutError';
  return ['native', 'unavailable', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ABORT_ERR'].includes(String(reason.code));
}
