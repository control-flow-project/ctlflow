export function isIdentityIdentifier(
  value: string
): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value);
}
