# Remaining canonical tenantd evidence

`resolve-tenant.test.ts` is the complete reference slice. Add one ordinary
`node:test` file per next public operation or aggregated resource family:

```text
resolve-workspace.test.ts
get-lifecycle.test.ts
acknowledge-child-state.test.ts
tenants.test.ts
workspaces.test.ts
```

Each file runs unchanged against every production implementation through the
shared mesh. Do not add skipped tests, scenario registries, implementation
branches, or an advertised API without its real-process evidence.
