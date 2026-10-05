export type DirectedInput = { messageId: string; text: string; expiresAt: number };
export type ControllerState = { connected: boolean; deliveryEnabled: boolean; revision: number | null; error: string | null };
export type ListenerControl = {
  current(): { active: boolean; signal: AbortSignal; input: DirectedInput | null };
  subscribe(changed: () => void): () => void;
  unavailable(reason: string): void;
  acknowledge(messageId: string, status: 'delivered' | 'skipped', errorMessage: string | null): Promise<void>;
};
