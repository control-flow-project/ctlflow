export type CoordinationPolicy = {
  wakeMode: 'nobody' | 'owner' | 'owner-agents' | 'humans' | 'everyone' | 'selected';
  senderMatrixIds: string[];
  permissions: 'room.agent.invite'[];
};
