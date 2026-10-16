# Server operator argument symmetry — 2026-10-16

## Corrections

| ID | Defect | Current behavior |
| --- | --- | --- |
| SYM-001 | Node retained the last repeated option; C# rejected duplicates | Both reject repeated initialization/startup options, even when values are identical |
| SYM-002 | Node admitted alternate numeric notation; C# admitted noncanonical decimal forms | Both accept only ASCII decimal ports in 1024..65535, without leading zeros, signs, whitespace or alternate notation |
| SYM-003 | C# operator exceptions aborted the process and invoked crash handling | Both emit the diagnostic on standard error and exit normally with code 1 |

The operator remains the validation owner. Node rejects normalized duplicate
option tokens before using their values. Both port parsers enforce the same
lexical/range rules, defaults and distinct application/content ports. C#'s
entrypoint presents failures; its internal throwing API and lifecycle cleanup
remain unchanged. There is no parser fallback or alternative runtime path.

## Verification

- Root Node typecheck/build and ownership/layout/documentation checks pass.
- Actual Linux x64 managed and NativeAOT server publications pass using the
  existing pinned SDK and dependencies. AOT diagnostics remain unsuppressed.
- Nineteen affected tests pass, with zero failures, cancellations or skips:
  the existing Node operator unit suite and one shared external operator corpus
  against Node, managed C# and NativeAOT C#.
- The corpus performs 89 CLI invocations per target: initialization, 22 repeated
  option cases, 58 malformed/out-of-range port cases, a conflicting-port case,
  and seven default/canonical-boundary admissions. This includes both port flags.
- Rejections require a normal exit with exact status 1 and the expected diagnostic.
  They cannot invoke the inert Docker probe, create a lock or change private
  configuration/credential bytes. Admitted cases reach exactly the engine check
  without loading the deliberately absent package or starting containers.
- The corpus is part of the ordinary shared product contract worker; it is not
  a language-specific set of expected values. Four independent test files run in
  parallel within a 32 GiB, zero-swap, 8,192-task process group.

The first native probe exposed SYM-003. Its permissive signal handling was
replaced with strict normal-exit assertions, and both native modes were rebuilt
and retested. No timeout was extended and no host crash policy was changed.

This is focused CLI verification. HTTP/UI, provider, full container and migration
banks were not rerun for this isolated argument-boundary change. Their earlier
results are not represented as new executions. No package/SDK/dependency version,
database, production service, fleet definition or native history was changed.
No deployment or package publication was performed.

Regenerable build/test/temp output is removed after verification. Only source,
this report and concise local verification records are retained.
