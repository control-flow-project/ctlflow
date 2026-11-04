export function truncateUtf16(value: string, maximum: number): string {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || !value.isWellFormed()) throw new Error('Use well-formed Unicode and a nonnegative text bound');
  if (value.length <= maximum) return value;
  const boundary = maximum > 0 && value.charCodeAt(maximum - 1) >= 0xd800 && value.charCodeAt(maximum - 1) <= 0xdbff
    && value.charCodeAt(maximum) >= 0xdc00 && value.charCodeAt(maximum) <= 0xdfff ? maximum - 1 : maximum;
  return value.slice(0, boundary);
}

export function truncateUtf8(value: string, maximum: number): string {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || !value.isWellFormed()) throw new Error('Use well-formed Unicode and a nonnegative text bound');
  let bytes = 0, boundary = 0;
  for (const character of value) {
    const scalar = character.codePointAt(0)!;
    bytes += scalar <= 0x7f ? 1 : scalar <= 0x7ff ? 2 : scalar <= 0xffff ? 3 : 4;
    if (bytes > maximum) break;
    boundary += character.length;
  }
  return value.slice(0, boundary);
}
