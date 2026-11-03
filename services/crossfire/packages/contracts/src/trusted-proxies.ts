import { isIP } from 'node:net';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';

export function addressKey(value: unknown): string | null {
  if (typeof value !== 'string' || value.includes('%') || !isIP(value)) return null;
  if (isIP(value) === 4) return value;
  const normalized = new URL('http://[' + value + ']/').hostname.slice(1, -1);
  const halves = normalized.split('::'), left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 1 ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  if (groups.slice(0, 5).every(group => Number.parseInt(group, 16) === 0) && Number.parseInt(groups[5]!, 16) === 65535) {
    const high = Number.parseInt(groups[6]!, 16), low = Number.parseInt(groups[7]!, 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return groups.map(group => group.padStart(4, '0')).join(':');
}

export function trustedProxyAddresses(value: unknown = []): Result<string[]> {
  if (!Array.isArray(value) || value.length > 32) return failure('invalid', 'trustedProxyAddresses must contain at most 32 distinct IP addresses');
  const addresses: string[] = [];
  for (const entry of value) {
    const key = addressKey(entry);
    if (key === null || addresses.includes(key)) return failure('invalid', 'trustedProxyAddresses must contain distinct literal IP addresses without scopes or networks');
    addresses.push(key);
  }
  return success(addresses);
}

