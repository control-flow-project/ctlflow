export type Parameter = {
  name: string;
  location: 'path' | 'query';
  required: boolean;
  type: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';
  values?: readonly (string | number | boolean)[];
  minimum?: number;
  maximum?: number;
};

export type Operation = {
  id: string;
  command: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  access: 'agent' | 'account' | 'operator' | 'unsupported' | 'deprecated';
  parameters: readonly Parameter[];
  body: 'none' | 'optional' | 'required' | 'binary';
  response: 'json' | 'binary';
};

export type MatrixSchema = {
  version: string;
  sourceSha256: string;
  operations: readonly Operation[];
};

export function kebab(value: string): string {
  return value.replace(/[A-Z]{2,}s(?=$|_|[A-Z])/g, plural => plural[0] + plural.slice(1).toLowerCase())
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2').replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-').toLowerCase();
}
