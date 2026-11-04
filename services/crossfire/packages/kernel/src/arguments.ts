export type Arguments = Readonly<Record<string, string | boolean | readonly string[] | undefined>>;
export function option(arguments_: Arguments, name: string): string | undefined {
  const value = arguments_[name];
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length === 1) return value[0]!;
  throw new Error(`--${name} requires exactly one value`);
}
