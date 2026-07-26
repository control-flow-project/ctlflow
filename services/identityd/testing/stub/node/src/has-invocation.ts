export function hasInvocation(
  values: readonly (string | Buffer)[]
): boolean {
  return values.length === 1
    && typeof values[0] === "string"
    && values[0].startsWith("Bearer ")
    && values[0].length > "Bearer ".length
    && !/\s/u.test(
      values[0].slice("Bearer ".length));
}
