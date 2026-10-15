import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { HTTP_LIMITS } from '@ctlflow/crossfire-contracts/rest/limits';

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

export function publicRequestBudget(now: () => number, proxies: readonly string[] = []) {
  const trusted = new Set(proxies), clients = new Map<string, { count: number; expiresAt: number }>();
  let aggregate = { count: 0, expiresAt: 0 };
  let nextExpiry = Number.POSITIVE_INFINITY;
  return (request: Pick<IncomingMessage, 'socket' | 'headers' | 'rawHeaders'>): Result<void> => {
    let key = addressKey(request.socket.remoteAddress);
    if (key === null) return failure('forbidden', 'Client address is unavailable');
    if (trusted.has(key)) {
      const headers = request.rawHeaders.filter((_value, index) => index % 2 === 0 && request.rawHeaders[index]!.toLowerCase() === 'x-forwarded-for');
      if (headers.length !== 1 || (key = addressKey(request.headers['x-forwarded-for'])) === null) return failure('forbidden', 'Trusted ingress must overwrite X-Forwarded-For with one literal client IP address');
    }
    const time = now();
    if (time >= nextExpiry) {
      nextExpiry = Number.POSITIVE_INFINITY;
      for (const [address, entry] of clients) {
        if (entry.expiresAt <= time) clients.delete(address);
        else nextExpiry = Math.min(nextExpiry, entry.expiresAt);
      }
    }
    if (aggregate.expiresAt <= time) aggregate = { count: 0, expiresAt: time + 60_000 };
    const entry = clients.get(key) ?? { count: 0, expiresAt: time + 60_000 };
    if (entry.count >= HTTP_LIMITS.publicMutationsPerMinute || aggregate.count >= HTTP_LIMITS.publicMutationsGlobalPerMinute
      || !clients.has(key) && clients.size >= HTTP_LIMITS.publicMutationClients) return failure('rate_limit', 'Request rate exceeded');
    entry.count++; clients.set(key, entry); aggregate.count++; nextExpiry = Math.min(nextExpiry, entry.expiresAt);
    return success(undefined);
  };
}
