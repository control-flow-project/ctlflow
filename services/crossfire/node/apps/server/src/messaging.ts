import type { Services } from '@ctlflow/crossfire-domain/port/services';
import type { MessagingAuthority } from '@ctlflow/crossfire-domain/port/messaging';
import { createMessagingAuthority } from '@ctlflow/crossfire-adapter-matrix/create-authority';
import { matrixConfiguration, serviceUser, localAdministrator } from '@ctlflow/crossfire-adapter-matrix/config';
import { createMatrixHttp } from '@ctlflow/crossfire-adapter-matrix/web/handler';
import type { Config } from './config.js';
import { readBody, readForm } from './http/transport.js';
import { invitationCookie, setInvitationCookie } from './http/invitation-cookie.js';
import type { MessagingHttpFactory } from './http/messaging.js';

export type BackendIntegration = { authority: MessagingAuthority; http(services: Services): MessagingHttpFactory };
export type BackendFactory = (config: Config) => BackendIntegration;

export function backendHttp(config: Config, serverName: string): BackendIntegration['http'] {
  return services => createMatrixHttp(services, { get publicOrigin() { return config.publicOrigin; }, serverName },
    { readBody, readForm, invitationCookie, setInvitationCookie });
}

export function configureBackend(config: Config): BackendIntegration {
  const parsed = matrixConfiguration(config.messaging);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const configuration = parsed.value;
  if (new URL(config.contentOrigin).hostname === new URL(configuration.matrixOrigin).hostname)
    throw new Error('Publications require a separate backend hostname');
  if (!localAdministrator(config.administrator, configuration)) throw new Error('Administrator must belong to the configured backend');
  return {
    authority: createMessagingAuthority({ ...configuration, serviceBackendUserId: serviceUser(config.instance, configuration) }),
    http: backendHttp(config, configuration.serverName),
  };
}
