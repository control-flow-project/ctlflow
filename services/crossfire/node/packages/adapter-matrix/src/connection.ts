import type { BackendConfiguration, BackendAccount } from '@ctlflow/crossfire-domain/port/messaging';
import type { MessagingConnection } from '@ctlflow/crossfire-domain/port/messaging-client';
import { fields, text } from '@ctlflow/crossfire-contracts/validation';
import { endpoint } from '@ctlflow/crossfire-contracts/origin';
import { createInvitationReader } from './room/invitation.js';
import { createMessagingClient } from './messaging-client.js';
import { matrix } from './http.js';
import { userId } from './syntax.js';

export function clientConfiguration(configuration: BackendConfiguration): { origin: string; serverName: string } {
  const parameters = fields(configuration.parameters, ['origin', 'serverName']);
  if (configuration.type !== 'matrix' || !parameters.ok || !text(parameters.value.serverName, 255) || typeof parameters.value.origin !== 'string')
    throw new Error('Invalid Matrix client configuration');
  const origin = endpoint(parameters.value.origin);
  if (!origin.ok) throw new Error(origin.error.message);
  return { origin: origin.value, serverName: parameters.value.serverName };
}
export function connectMatrix(configuration: BackendConfiguration, account: BackendAccount): MessagingConnection {
  const parameters = clientConfiguration(configuration);
  if (!userId(account.userId) || !text(account.accessToken, 8192)) throw new Error('Invalid Matrix account');
  const pending = createInvitationReader();
  return {
    transport: (signal, timeoutMs) => createMessagingClient(matrix({ base: parameters.origin, token: account.accessToken, signal, timeoutMs }), account.userId),
    async invitationRooms(signal) {
      const result = await pending({ base: parameters.origin, token: account.accessToken, signal, timeoutMs: 45000 }, account.userId);
      if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
      return [...result.value.keys()];
    },
  };
}
