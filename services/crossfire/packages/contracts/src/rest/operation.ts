import type { Parser, Parsed } from '../schema/validation.js';
export type Operation<Params, Query, Input, Output> = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; auth: 'public' | 'human' | 'agent' | 'either';
  params: Parser<Params>; query: Parser<Query>; input: Parser<Input>; output: Parser<Output>;
  status: 200 | 201 | 202; collection: boolean; permissions: readonly string[]; description: string;
};
export function operation<Params, Query, Input, Output>(definition: Operation<Params, Query, Input, Output>): Operation<Params, Query, Input, Output> { return definition; }
export type ParamsOf<Value extends { params: Parser<unknown> }> = Parsed<Value['params']>;
export type QueryOf<Value extends { query: Parser<unknown> }> = Parsed<Value['query']>;
export type InputOf<Value extends { input: Parser<unknown> }> = Parsed<Value['input']>;
export type OutputOf<Value extends { output: Parser<unknown> }> = Parsed<Value['output']>;
export function operationPath(path: string, params: Record<string, string>): string {
  return path.replace(/\{([A-Za-z]+)\}/gu, (_match: string, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error('Missing route parameter: ' + key);
    return encodeURIComponent(value);
  });
}
