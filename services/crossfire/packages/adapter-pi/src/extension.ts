type Context = {
  isIdle(): boolean; abort(): void; waitForIdle(): Promise<void>; getSystemPrompt(): string;
  sessionManager: { getLeafId(): string | null; getSessionId(): string };
  ui: { notify(message: string, type: string): void; select(title: string, options: string[], options_: { signal?: AbortSignal }): Promise<string | undefined>;
    input(title: string, placeholder: string, options_: { signal?: AbortSignal }): Promise<string | undefined> };
};
type ExtensionApi = {
  on(event: string, handler: (event: Record<string, unknown>, context: Context) => void | Promise<void>): void;
  appendEntry(type: string, data: unknown): void;
  sendUserMessage(text: string, options: { deliverAs: 'followUp' }): void;
  registerCommand(name: string, command: { description: string; handler(arguments_: string, context: Context): Promise<void> }): void;
  registerTool(tool: { name: string; label: string; description: string; parameters: Record<string, unknown>;
    execute(id: string, parameters: Record<string, unknown>, signal: AbortSignal | undefined, update: unknown, context: Context): Promise<unknown> }): void;
};

export function piExtension(pi: ExtensionApi): void {
  let turn: string | null = null;
  let pending: { messageId: string; text: string } | null = null;
  pi.on('agent_start', () => { turn ??= crypto.randomUUID(); });
  pi.on('agent_settled', () => { turn = null; });
  pi.on('message_end', event => {
    const message = event.message;
    if (!pending || !message || typeof message !== 'object' || !('role' in message) || message.role !== 'user'
      || !('content' in message) || !Array.isArray(message.content) || message.content.length !== 1) return;
    const content = message.content[0] as unknown;
    if (!content || typeof content !== 'object' || !('type' in content) || content.type !== 'text' || !('text' in content) || content.text !== pending.text) return;
    pi.appendEntry('crossfire-input', { messageId: pending.messageId, text: pending.text });
    pending = null;
  });
  pi.registerCommand('crossfire-control', { description: 'Private fleet adapter control; not a conversation command', async handler(arguments_, context) {
    const request: unknown = JSON.parse(Buffer.from(arguments_, 'base64url').toString('utf8'));
    if (!request || typeof request !== 'object' || Array.isArray(request) || !('id' in request) || typeof request.id !== 'string'
      || !('operation' in request) || typeof request.operation !== 'string') throw new Error('Invalid private control');
    const value = request as Record<string, unknown>;
    let data: unknown;
    if (value.operation === 'state') data = { turn: context.isIdle() ? null : turn, idle: context.isIdle(), leafId: context.sessionManager.getLeafId(), sessionId: context.sessionManager.getSessionId(), pending: pending?.messageId ?? null };
    else if (value.operation === 'instructions') {
      if (typeof value.text !== 'string' || typeof value.digest !== 'string' || !context.getSystemPrompt().includes(value.text)) throw new Error('Pi did not apply the exact instructions');
      pi.appendEntry('crossfire-instructions', { digest: value.digest, text: value.text });
      data = { entryId: context.sessionManager.getLeafId() };
    } else if (value.operation === 'deliver') {
      if (pending || typeof value.text !== 'string' || typeof value.messageId !== 'string') throw new Error('Pi already has a pending native input or the input is invalid');
      if (!context.isIdle()) data = { armed: false };
      else {
        pending = { text: value.text, messageId: value.messageId };
        pi.sendUserMessage(value.text, { deliverAs: 'followUp' });
        data = { armed: true };
      }
    } else if (value.operation === 'interrupt') {
      if (typeof value.turn !== 'string') throw new Error('Invalid captured Pi execution');
      if (turn !== value.turn || context.isIdle()) data = { interrupted: false };
      else {
        context.ui.notify(JSON.stringify({ crossfireEvent: 'interruption', turn }), 'info');
        context.abort(); await context.waitForIdle(); data = { interrupted: true };
      }
    } else throw new Error('Unsupported private Pi control');
    context.ui.notify(JSON.stringify({ crossfire: true, id: value.id, data }), 'info');
  } });
  pi.registerTool({ name: 'crossfire_question', label: 'Ask the owner', description: 'Ask the owner a required question through the verified Crossfire decision UI. Cancellation is not permission. Never ask for credentials.',
    parameters: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 1000, pattern: '^[^\\u0000-\\u001f\\u007f]+$' },
      prompt: { type: 'string', maxLength: 16000, description: 'Plain text, at most 16,000 UTF-8 bytes.' },
      options: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true,
        items: { type: 'string', minLength: 1, maxLength: 1000, pattern: '^[^\\u0000-\\u001f\\u007f]+$' } } }, required: ['title', 'prompt'], additionalProperties: false },
    async execute(_id, parameters, signal, _update, context) {
      signal?.throwIfAborted();
      const title = parameters.title, prompt = parameters.prompt, choices = parameters.options;
      if (typeof title !== 'string' || !title.length || title.length > 1000 || /[\u0000-\u001f\u007f]/u.test(title)) throw new Error('Question title must contain 1–1,000 text characters without control codes.');
      if (typeof prompt !== 'string' || Buffer.byteLength(prompt) > 16000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(prompt)) throw new Error('Question prompt must be plain text up to 16,000 UTF-8 bytes.');
      if (choices !== undefined && (!Array.isArray(choices) || choices.length < 1 || choices.length > 100 || new Set(choices).size !== choices.length
        || choices.some(choice => typeof choice !== 'string' || !choice.length || choice.length > 1000 || /[\u0000-\u001f\u007f]/u.test(choice)))) throw new Error('Question options must be 1–100 unique bounded text labels without control codes.');
      const options_ = signal ? { signal } : {};
      const answer = Array.isArray(choices) ? await context.ui.select(title + '\n' + prompt, choices as string[], options_) : await context.ui.input(title, prompt, options_);
      signal?.throwIfAborted();
      return { content: [{ type: 'text', text: answer === undefined ? 'Owner question cancelled; no authorization or answer was given.' : JSON.stringify({ answer }) }], details: {} };
    } });
}

export function piExtensionSource(): string { return 'export default ' + piExtension.toString() + '\n'; }
