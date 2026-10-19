import type { MessagingTools } from '@ctlflow/crossfire-domain/port/messaging-tools';
import { json } from '@ctlflow/crossfire-kernel/json';
import { clientConfiguration } from './connection.js';
import { matrix } from './http.js';
import { operations, selectOperation, executeOperation, operationOptions } from './commands.js';
import { option } from '@ctlflow/crossfire-kernel/arguments';
import { inbox, projectMessages } from './projection.js';
import type { MatrixSync } from './values.js';

export const matrixTools: MessagingTools = {
  id: 'matrix', description: 'Matrix operation IDs converted to kebab-case. Use matrix COMMAND --help.',
  options: [...new Set(operations.flatMap(operationOptions))],
  help(command) {
    if (!command) return { namespace: 'matrix', schema: 'v1.12', operations: operations.map(operation => ({ command: operation.command, access: operation.access })) };
    const operation = selectOperation(command);
    const result: unknown = { ...operation, cli_options: operationOptions(operation) };
    if (!json(result)) throw new Error('Invalid Matrix operation metadata');
    return result;
  },
  commandOptions: command => operationOptions(selectOperation(command)),
  async execute(context, command, arguments_) {
    const operation = selectOperation(command), view = option(arguments_, 'view');
    if (view && !['messages', 'inbox'].includes(view)) throw new Error('Unknown output view');
    if (view === 'inbox' && operation.id !== 'sync') throw new Error('--view inbox requires matrix sync');
    if (view && option(arguments_, 'output-file')) throw new Error('File output preserves the native response; do not combine it with --view');
    const unlock = ['setReadMarker', 'postReceipt'].includes(operation.id) ? await context.lock() : undefined;
    try {
      const configuration = clientConfiguration(context.configuration);
      const client = matrix({ base: configuration.origin, token: context.account.accessToken });
      const settings = { instance: context.instance, server: context.server, backend: context.configuration, owner: context.owner, maxUploadBytes: context.maxUploadBytes };
      const result = await executeOperation(client, settings, context.account, operation, arguments_);
      return view === 'inbox' ? inbox(result as MatrixSync) : view === 'messages' ? projectMessages(result) : result;
    } finally { await unlock?.(); }
  },
};
