import type { MatrixWakeSelection } from '../wake/types.js';

export type CoordinationPolicy = {
  wakeMode: 'humans' | 'everyone' | 'selected';
  senders: MatrixWakeSelection[];
  permissions: 'room.agent.invite'[];
};
