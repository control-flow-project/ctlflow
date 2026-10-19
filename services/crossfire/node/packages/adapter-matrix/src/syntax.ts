export function userId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 255 && value.isWellFormed() && /^@[^:\s]+:[^\s]+$/u.test(value);
}
export function roomId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 255 && value.isWellFormed() && /^!\S+$/u.test(value);
}
export function eventId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 255 && value.isWellFormed() && /^\$\S+$/u.test(value);
}
