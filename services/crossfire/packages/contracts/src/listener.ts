import type { WakePolicy } from './wake.js';
export type ListenerOptions = { historyMode?: 'shared' | 'per-room'; mirrorOutput?: boolean };
export type SavedRuntimeContext = { context: string; runtime: string; sessionId: string; workspace: string };
export type ControllerState = { connected: boolean; deliveryEnabled: boolean; revision: number | null; error: string | null };
export type RuntimeApproval = 'none' | 'runtime' | 'listener';
export type ListenerTest = { session: string; server: string; authenticated: true; rooms: number; joinedRooms: number;
  canReceiveRoomTasks: boolean; wakeMode: WakePolicy; busy: boolean; deliveryPaused: boolean; approval: RuntimeApproval; currentRelease: string; message: string };
