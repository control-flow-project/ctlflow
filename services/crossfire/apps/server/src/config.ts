import { fields, text, userId } from "@ctlflow/crossfire-contracts/validation";
import { failure, success, type Result } from "@ctlflow/crossfire-kernel/result";
import { endpoint } from '@ctlflow/crossfire-contracts/origin';
import { PUBLICATION_LIMITS, type PublicationBudget } from '@ctlflow/crossfire-domain/publication/values';
import { loggingRetentionDays } from '@ctlflow/crossfire-kernel/logging';

export type Config = {
  instance: string; serverName: string; publicOrigin: string; contentOrigin: string; matrixOrigin: string;
  administrator: string; jwtSecret: string; registrationSecret: string;
  publicationBudget?: PublicationBudget;
  loggingRetentionDays?: number;
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

export function serviceUser(config: Config): string {
  return "@crossfire-" + config.instance + ":" + config.serverName;
}

export function config(value: unknown): Result<Config> {
  const parsed = fields(value, ["instance", "serverName", "publicOrigin", "contentOrigin", "matrixOrigin", "administrator", "jwtSecret", "registrationSecret"], ['publicationBudget', 'loggingRetentionDays']);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  if (!text(input.instance, 40) || !/^[a-z][a-z0-9-]*$/u.test(input.instance)
    || !text(input.serverName, 200) || !/^[a-z0-9.-]+(?::[0-9]+)?$/u.test(input.serverName)
    || !userId(input.administrator) || !input.administrator.endsWith(":" + input.serverName)
    || !text(input.jwtSecret, 200) || input.jwtSecret.length < 32
    || !text(input.registrationSecret, 200) || input.registrationSecret.length < 32
    || typeof input.publicOrigin !== "string" || typeof input.contentOrigin !== 'string' || typeof input.matrixOrigin !== "string") return failure("invalid", "Invalid server configuration");
  const publicOrigin = endpoint(input.publicOrigin);
  const matrixOrigin = endpoint(input.matrixOrigin);
  const contentOrigin = endpoint(input.contentOrigin);
  if (!publicOrigin.ok) return publicOrigin;
  if (!matrixOrigin.ok) return matrixOrigin;
  if (!contentOrigin.ok) return contentOrigin;
  if (contentOrigin.value === publicOrigin.value || contentOrigin.value === matrixOrigin.value
    || new URL(contentOrigin.value).protocol === 'https:' && [new URL(publicOrigin.value).hostname, new URL(matrixOrigin.value).hostname].includes(new URL(contentOrigin.value).hostname))
    return failure('invalid', 'Publications require a separate content hostname and origin');
  const budget = publicationBudget(input.publicationBudget); if (!budget.ok) return budget;
  const retention = loggingRetentionDays(input.loggingRetentionDays); if (!retention.ok) return retention;
  return success({ instance: input.instance, serverName: input.serverName, publicOrigin: publicOrigin.value,
    contentOrigin: contentOrigin.value, matrixOrigin: matrixOrigin.value, administrator: input.administrator, jwtSecret: input.jwtSecret,
    registrationSecret: input.registrationSecret, publicationBudget: budget.value, loggingRetentionDays: retention.value });
}
