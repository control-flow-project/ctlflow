export function piErrorText(message: string): string {
  let text = '', bytes = 0;
  for (const character of message) {
    const safe = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(character) ? ' ' : character;
    const size = Buffer.byteLength(safe);
    if (bytes + size > 4000) break;
    text += safe; bytes += size;
  }
  return text;
}
