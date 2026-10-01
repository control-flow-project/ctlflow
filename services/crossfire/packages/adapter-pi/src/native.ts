export type PiContext = {
  cwd: string;
  signal: AbortSignal | undefined;
  isIdle: () => boolean;
  isProjectTrusted: () => boolean;
  abort: () => void;
  sessionManager: {
    getSessionId: () => string;
    getSessionFile: () => string | undefined;
    getLeafId: () => string | null;
    getBranch: () => readonly unknown[];
  };
};

export type PiApi = {
  on: (event: 'session_start' | 'session_shutdown' | 'session_before_tree' | 'agent_start' | 'agent_end' | 'agent_settled', handler: (event: unknown, context: PiContext) => void | Promise<void>) => unknown;
  sendMessage: (message: { customType: string; content: string; display: boolean; details: { messageId: string } },
    options: { triggerTurn: boolean; deliverAs: 'followUp' }) => void;
};
