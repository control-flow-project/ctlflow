export function truncateUtf16(value: string, maximum: number): string {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || !value.isWellFormed()) throw new Error('Use well-formed Unicode and a nonnegative text bound');
  if (value.length <= maximum) return value;
  const boundary = maximum > 0 && value.charCodeAt(maximum - 1) >= 0xd800 && value.charCodeAt(maximum - 1) <= 0xdbff
    && value.charCodeAt(maximum) >= 0xdc00 && value.charCodeAt(maximum) <= 0xdfff ? maximum - 1 : maximum;
  return value.slice(0, boundary);
}
