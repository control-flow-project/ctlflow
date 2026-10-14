# Pinned EF query compiler

Build-only source from `dotnet/efcore`, tag `v11.0.0-rc.1.26425.128`, commit
`c22dd77aa7f7392f997cf779f0c23e0b9aab1988`. Original .NET Foundation MIT headers
remain intact. This project is not a production runtime dependency.

The query generator emits `#nullable enable annotations` itself, resolving the
confirmed owning-generator defect tracked in EF issue 37996 and PR 39224.
Generated output is not patched afterward. The design-time generator registration
uses EF's existing interface, with one selected implementation. All native and
trimming diagnostics remain visible; this corrects C# source generation only.

The locator recognizes a strongly typed DbContext method parameter, as well as
locals, fields and properties. Upstream omits `IParameterSymbol`, incorrectly
rejecting these static repository queries as dynamic. The owning locator is
corrected instead of imposing artificial local-variable aliases on callers.
Managed and native acceptance execute the identical repository queries.

The translator also handles captured method parameters, anonymous-object
identifier shorthand and numeric literal conversions using their actual source
carrier. File-owned namespace, constant, accessor and translator state is reset
at the owning generated-file boundary. No global application using directives,
literal suffix requirements or generated-output repairs compensate for compiler
defects. Multi-file native repository acceptance covers these corrections.

Queries are scoped to the DbContext currently being generated. The locator
resolves the actual context symbol before admitting a query; multiple context
types cannot produce duplicate interceptors or accidentally compile each other's
queries. Database migrations remain exclusively in Knex, not in an EF context.

Build-time captured concrete objects use constructor-free typed placeholders,
rather than null, so ordinary captured scalar property access can be analyzed.
User constructors are never executed during compilation. These placeholders are
only compiler inputs; native query parameters still come from the actual caller.

The selected native expression emitter removes provably impossible interface
tests on sealed local variables before generating C#. Side-effecting expressions
are not folded. This fixes invalid materializer casts at their generator owner;
entities do not need artificial inheritance solely to make emitted C# compile.

Filtered queryable join inputs are analyzed as query expression trees, not scalar
parameters. Captured values in each input flow into the one compiled query context;
the query container is never added under an empty parameter name. Native controller
admission verifies multiple independently filtered joins and their exact values.

Only DbSet roots are bound during source analysis. Query operators and actual
caller parameter expressions remain intact, so paging cannot freeze to build-time
placeholder values. The selected build-only funcletizer does not simplify a
captured nullable/Boolean/conditional guard using placeholder values. Constant
expressions remain foldable; native parameter extraction uses the actual caller.

Source declarations are preserved rather than split into differently maintained
copies. Helper sources belong to the same pinned upstream implementation.

Expected CLR argument conversions, including first-class array-to-span extension
receivers and boxed nullable setters, are translated before EF analysis. Span
operation SQL lowering retains paths into the original caller expression rather
than trying to box a ref-like value in the NativeAOT interpreter. Preserved
conversion nodes propagate their local captured-value state back to the owning
argument, so ExecuteUpdate binds every numeric and nullable setter. Native fleet
broadcast queries and membership-generation replacement exercise these cases.

Membership generations are mutable SQLite unique-key values, not immutable EF
entity identities. Their owning repository uses EF ExecuteUpdate, retaining the
canonical row, dependent application, triggers and database constraints. It does
not delete/reinsert grants, bypass EF or add another schema representation.

`../NativeQueries.targets` selects the same build configuration, platform and
framework for EF's child compiler as the publishing project. The pinned EF task
otherwise loads its Roslyn project with default Debug references even during a
Release publish. Clean Release-only acceptance removes Debug output first; it
must not rely on stale assemblies from an unrelated earlier build. This target
replaces the imported `OptimizeDbContext` target, keeps the pinned EF task and
generated-file lifecycle, and supplies its child-process environment explicitly.
It neither patches NuGet nor adds another generator or runtime path.

Object constructors, member initializers and collection initializers apply the
actual CLR argument/member conversion, including non-nullable aggregate results
assigned to nullable members. Callers do not add redundant casts to accommodate
an incomplete compiler. Database-side listener totals exercise this conversion.
