type Scope = { after(operation: () => Promise<void>): void };
type Dispose = () => unknown;
const resources = new WeakMap<Scope, Dispose[]>();

export function cleanup(scope: Scope, dispose: Dispose): void {
  let owned = resources.get(scope);
  if (!owned) {
    owned = [];
    resources.set(scope, owned);
    scope.after(async () => {
      const pending = resources.get(scope)!;
      const failures: unknown[] = [];
      while (pending.length) {
        try { await pending.pop()!(); } catch (error) { failures.push(error); }
      }
      resources.delete(scope);
      if (failures.length) throw new AggregateError(failures, 'Fixture cleanup failed');
    });
  }
  owned.push(dispose);
}
