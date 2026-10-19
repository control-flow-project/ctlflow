import { fields, text, userId } from "@ctlflow/crossfire-contracts/validation";
import { failure, success, type Result } from "@ctlflow/crossfire-kernel/result";
import { endpoint } from '@ctlflow/crossfire-contracts/origin';
import { PUBLICATION_LIMITS, type PublicationBudget } from '@ctlflow/crossfire-domain/publication/values';
import { loggingRetentionDays } from '@ctlflow/crossfire-kernel/logging';
import { trustedProxyAddresses } from './http/public-request-budget.js';
import { backendConfiguration } from '@ctlflow/crossfire-contracts/client';
import type { BackendConfiguration } from '@ctlflow/crossfire-domain/port/messaging';

export type Config = {
  instance: string; publicOrigin: string; contentOrigin: string; messaging: BackendConfiguration; administrator: string;
  publicationBudget?: PublicationBudget;
  loggingRetentionDays?: number;
  trustedProxyAddresses?: string[];
};

export function publicationBudget(value: unknown = { instanceBytes: PUBLICATION_LIMITS.instanceBytes, agentBytes: PUBLICATION_LIMITS.agentBytes,
  instanceCount: PUBLICATION_LIMITS.instanceCount, agentCount: PUBLICATION_LIMITS.agentCount, uploads: PUBLICATION_LIMITS.uploads }): Result<PublicationBudget> {
  const names = ['instanceBytes', 'agentBytes', 'instanceCount', 'agentCount', 'uploads'] as const;
  const checked = fields(value, [...names]); if (!checked.ok) return checked;
  const input = checked.value;
  if (names.some(name => typeof input[name] !== 'number' || !Number.isSafeInteger(input[name]) || input[name] < 1)
    || typeof input.instanceBytes !== 'number' || input.instanceBytes > 1024 ** 4
    || typeof input.agentBytes !== 'number' || input.agentBytes > input.instanceBytes
    || typeof input.instanceCount !== 'number' || input.instanceCount > 100_000
    || typeof input.agentCount !== 'number' || input.agentCount > input.instanceCount
    || typeof input.uploads !== 'number' || input.uploads > 32) return failure('invalid', 'Publication budgets must be positive, finite and nested within the instance budget');
  return success({ instanceBytes: input.instanceBytes, agentBytes: input.agentBytes, instanceCount: input.instanceCount,
    agentCount: input.agentCount, uploads: input.uploads });
}

export function config(value: unknown): Result<Config> {
  const parsed = fields(value, ['instance', 'publicOrigin', 'contentOrigin', 'messaging', 'administrator'], ['publicationBudget', 'loggingRetentionDays', 'trustedProxyAddresses']);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  if (!text(input.instance, 40) || !/^[a-z][a-z0-9-]*$/u.test(input.instance)
    || !userId(input.administrator) || typeof input.publicOrigin !== 'string' || typeof input.contentOrigin !== 'string') return failure('invalid', 'Invalid server configuration');
  const publicOrigin = endpoint(input.publicOrigin);
  const messaging = backendConfiguration(input.messaging);
  const contentOrigin = endpoint(input.contentOrigin);
  if (!publicOrigin.ok) return publicOrigin;
  if (!messaging.ok) return messaging;
  if (!contentOrigin.ok) return contentOrigin;
  if (contentOrigin.value === publicOrigin.value || new URL(contentOrigin.value).hostname === new URL(publicOrigin.value).hostname)
    return failure('invalid', 'Publications require a separate content hostname and origin');
  const budget = publicationBudget(input.publicationBudget); if (!budget.ok) return budget;
  const retention = loggingRetentionDays(input.loggingRetentionDays); if (!retention.ok) return retention;
  const proxies = trustedProxyAddresses(input.trustedProxyAddresses); if (!proxies.ok) return proxies;
  return success({ instance: input.instance, publicOrigin: publicOrigin.value, contentOrigin: contentOrigin.value, messaging: messaging.value,
    administrator: input.administrator, publicationBudget: budget.value, loggingRetentionDays: retention.value, trustedProxyAddresses: proxies.value });
}
