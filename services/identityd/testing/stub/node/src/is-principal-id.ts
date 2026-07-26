export function isPrincipalId(value: string): boolean {
  return /^[a-z][a-z_]*:[a-z0-9][a-z0-9_.-]{0,255}$/u
    .test(value)
    && value.length <= 256;
}
