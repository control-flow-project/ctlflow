import { fields, grants, status, userId, type Grant, type Status } from './management.js';
import { failure, success, type Result } from './result.js';
import { wakePolicy, type WakePolicy } from './wake.js';
export type DeliveryPolicy = {
  id: string; owner: string; userId: string; status: Status; ownerStatus: Status;
  grants: Grant[]; wakePolicy: WakePolicy; senders: string[];
};
export function deliveryPolicy(value: unknown): Result<DeliveryPolicy> {
  const parsed = fields(value, ['id', 'owner', 'userId', 'status', 'ownerStatus', 'grants', 'wakePolicy', 'senders']);
  if (!parsed.ok) return parsed;
  const data = parsed.value;
  const access = grants(data.grants);
  if (!access.ok) return access;
  if (typeof data.id !== 'string' || !/^[a-f0-9-]{36}$/u.test(data.id) || !userId(data.owner) || !userId(data.userId)
    || !status(data.status) || !status(data.ownerStatus) || !wakePolicy(data.wakePolicy)
    || !Array.isArray(data.senders) || data.senders.length > 2000 || !data.senders.every(userId)
    || new Set(data.senders).size !== data.senders.length || data.senders.includes(data.userId)
    || (data.wakePolicy === 'nobody' ? data.senders.length !== 0
      : data.status === 'active' && data.ownerStatus === 'active' && !data.senders.includes(data.owner))) {
    return failure('invalid', 'Invalid listener delivery policy');
  }
  return success({ ...data, grants: access.value } as DeliveryPolicy);
}
