export function opaqueIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 255 && value.isWellFormed() && !/[\u0000-\u001f\u007f]/u.test(value);
}
