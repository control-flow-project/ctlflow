# Pinned EF query compiler

Build-only source is pinned to dotnet/efcore tag
`v11.0.0-rc.1.26425.128`, commit
`c22dd77aa7f7392f997cf779f0c23e0b9aab1988`.
Original .NET Foundation MIT headers/notices remain.
This project is not a production runtime dependency.

## Owned changes

| Area | Behavior |
| --- | --- |
| Generated annotations | Generator emits nullable annotations; output is not patched afterward |
| Query location | Typed DbContext parameters, locals, fields and properties are recognized |
| Context scope | Only the selected context produces its query interceptors |
| Captures | Actual caller parameters, including enclosing parameters read inside local functions, remain native query parameters |
| Syntax/conversions | Anonymous shorthand, numeric literals and CLR conversions retain their carriers |
| File scope | Namespace/constant/accessor/translator state resets per generated file |
| Build-time objects | Constructor-free typed placeholders; user constructors never execute |
| Materializer tests | Provably impossible interface tests on sealed locals are removed; side effects remain |
| Filtered joins | Query trees remain query roots with independently captured parameters |
| Partial evaluation | Only DbSet roots bind; nullable/Boolean/conditional captures are not frozen to placeholders |
| Ref-like arguments | Original expression paths remain; spans are not boxed into a native interpreter |
| Updates | Numeric/nullable setter conversions bind through the native query context |
| Initializers | Constructor/member/collection conversions follow actual CLR types |

These changes fix the owning compiler rather than requiring caller aliases,
redundant casts, artificial inheritance or generated-output repairs.
Captured expressions use interpretation instead of requiring a JIT.

Mutable SQLite membership generations are unique-key values, not EF entity
identities. Repositories use EF ExecuteUpdate and preserve the canonical row,
dependent state, triggers and constraints. There is no delete/reinsert or raw
application-SQL workaround.

## Build phase

NativeQueries.targets selects the publishing configuration, platform and
framework for EF's child compiler. Restore and build reevaluate through the
selected SDK so cold builds retain NuGet-generated BuildHost content.
Release publication must not depend on stale Debug assemblies.

One selected design-time registration owns generation.
Production excludes Roslyn/MSBuild/design/compiler tooling.
The generated model reads the actual Knex-created schema; EF creates no migration
history and owns no second DDL contract.

## Verification

Internal managed and actual NativeAOT tests execute fixed repository queries:
context parameters, captured values, joins, updates, aggregates and nullable
conversions. NativeAOT diagnostics remain visible.
Those tests do not certify arbitrary EF query shapes or reflected plugin models.

- [Native dependency limits](../../../../../docs/architecture/native-implementations.md)
