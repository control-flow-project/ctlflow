export function readTraceparent(
  values: readonly (string | Buffer)[]
): { readonly receivedTraceparent?: string } {
  return values.length === 1
      && typeof values[0] === "string"
    ? {
        receivedTraceparent: values[0]
      }
    : {};
}
