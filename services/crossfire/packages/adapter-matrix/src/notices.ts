import { MAX_MESSAGE_BYTES } from '@ctlflow/crossfire-contracts/limits';
import { NOTICE_MARKER } from './events.js';

export function ownerNotice(body: string) {
  const content = { msgtype: 'm.notice', body, [NOTICE_MARKER]: true };
  if (Buffer.byteLength(JSON.stringify(content)) > MAX_MESSAGE_BYTES) throw new Error('Encoded owner notice exceeds the native message limit');
  return content;
}
export function ownerNoticeFits(body: string): boolean {
  return Buffer.byteLength(JSON.stringify({ msgtype: 'm.notice', body, [NOTICE_MARKER]: true })) <= MAX_MESSAGE_BYTES;
}
export function ownerNoticeChunks(text: string): string[] {
  const maximum = MAX_MESSAGE_BYTES - Buffer.byteLength(JSON.stringify(ownerNotice('')));
  const result: string[] = [];
  let selected: string[] = [], size = 0;
  for (const character of text) {
    const bytes = Buffer.byteLength(JSON.stringify(character)) - 2;
    if (size + bytes > maximum) { result.push(selected.join('')); selected = []; size = 0; }
    selected.push(character); size += bytes;
  }
  if (selected.length) result.push(selected.join(''));
  return result;
}
