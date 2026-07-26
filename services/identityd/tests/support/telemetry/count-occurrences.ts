export function countOccurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}
