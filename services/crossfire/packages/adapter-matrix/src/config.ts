import { fields, text } from '@ctlflow/crossfire-contracts/validation';
import { endpoint } from '@ctlflow/crossfire-contracts/origin';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { BackendConfiguration } from '@ctlflow/crossfire-domain/port/messaging';
import { userId } from './syntax.js';

export type MatrixConfiguration = { serverName: string; matrixOrigin: string; jwtSecret: string; registrationSecret: string };
export function administratorUser(username: unknown, serverName: unknown): Result<string> {
  if (typeof username !== 'string' || !/^[a-z0-9._=-]{1,80}$/u.test(username) || username === 'conduit'
    || username.startsWith('crossfire-') || username.startsWith('agent-')) return failure('invalid', 'Supply a regular human --administrator username');
  if (typeof serverName !== 'string') return failure('invalid', 'Invalid Matrix server name');
  const administrator = '@' + username + ':' + serverName;
  return userId(administrator) ? success(administrator) : failure('invalid', 'Invalid Matrix administrator ID');
}
export function matrixConfiguration(configuration: BackendConfiguration): Result<MatrixConfiguration> {
  const fields_ = fields(configuration.parameters, ['serverName', 'origin', 'jwtSecret', 'registrationSecret']);
  if (configuration.type !== 'matrix' || !fields_.ok) return failure('invalid', 'Expected Matrix server configuration');
  const input = fields_.value;
  if (!text(input.serverName, 200) || !/^[a-z0-9.-]+(?::[0-9]+)?$/u.test(input.serverName)
    || !text(input.jwtSecret, 200) || input.jwtSecret.length < 32 || !text(input.registrationSecret, 200) || input.registrationSecret.length < 32
    || typeof input.origin !== 'string') return failure('invalid', 'Invalid Matrix server configuration');
  const origin = endpoint(input.origin);
  return origin.ok ? success({ serverName: input.serverName, matrixOrigin: origin.value, jwtSecret: input.jwtSecret, registrationSecret: input.registrationSecret }) : origin;
}
export function serviceUser(instance: string, configuration: MatrixConfiguration): string {
  return '@crossfire-' + instance + ':' + configuration.serverName;
}
export function localAdministrator(id: string, configuration: MatrixConfiguration): boolean {
  return userId(id) && id.endsWith(':' + configuration.serverName);
}
