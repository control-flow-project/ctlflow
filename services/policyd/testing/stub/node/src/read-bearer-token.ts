export function readBearerToken(
  values: readonly (string | Buffer)[]
): string | undefined {
  if (
    values.length !== 1
    || typeof values[0] !== "string"
    || !values[0].startsWith("Bearer ")
  ) {
    return undefined;
  }
  const token = values[0].slice("Bearer ".length);
  return token.length > 0 && !/\s/u.test(token)
    ? token
    : undefined;
}
