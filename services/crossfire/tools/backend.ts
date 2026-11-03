import type { BackendConfiguration } from '@ctlflow/crossfire-domain/port/messaging';
import { matrixInspection } from '@ctlflow/crossfire-adapter-matrix/inspection';
import { clientConfiguration } from '@ctlflow/crossfire-adapter-matrix/connection';

export function inspectBackend(configuration: BackendConfiguration, token: string, signal?: AbortSignal) {
  const parameters = clientConfiguration(configuration);
  return matrixInspection({ base: parameters.origin, token, ...(signal ? { signal } : {}) });
}
