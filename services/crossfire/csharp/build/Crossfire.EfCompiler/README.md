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

Source declarations are preserved rather than split into differently maintained
copies. Helper sources belong to the same pinned upstream implementation.
