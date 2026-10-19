import type { BackendWakeSelection } from '../wake/types.js';

export type CoordinationPolicy = {
  wakeMode: 'humans' | 'everyone' | 'selected';
  senders: BackendWakeSelection[];
  permissions: 'room.agent.invite'[];
};
