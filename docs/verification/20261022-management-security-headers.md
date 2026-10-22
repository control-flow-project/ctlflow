# Management document headers — 2026-10-22

## Defect and correction

The live GAAP signup-origin browser check failed because `/manage/` returned no
`Referrer-Policy` header. The C# management-file handler supplied its content
security policy but omitted both `Referrer-Policy: no-referrer` and
`X-Frame-Options: DENY`. Node and Rust already set both headers on that route.

The correction belongs to C# `PublicApplication`, alongside its existing
management content security policy. It does not add a proxy rule or change
backend-owned signup pages. Signup confirmation retains `same-origin`, which
allows its form to submit the origin validated by the server.

## Verification

The shared server contract now checks GET and HEAD for `/manage`, `/manage/`
and `/manage/fleets`. Each response must have status 200, one exact
`no-referrer` policy and `DENY` framing policy. Every selected executable target
receives these same assertions.

The new assertions were also executed against isolated Docker deployments of
Node, managed C# and C# NativeAOT, with actual Matrix startup and the matching
Knex initialization. All three tests pass, with no skips, in 22.688 seconds:
18 requests and 54 status/header assertions across the selected targets.
Owned test containers and volumes were removed afterwards. Workspace typecheck
passes. Both C# image variants build with the pinned .NET 11 RC2 SDK; the
existing EF NativeAOT diagnostics remain visible in build logs.

Rust's management handler is unchanged and already supplies both headers. No
new Rust runtime, full product-bank or performance result is claimed here.
The earlier full release results remain recorded separately in
[the sanitizer release record](20261022-sanitizer-release.md).

## Release identity

The rebuilt server packages have source fingerprint
`5654753e2dc919318e6d88d8679e95dbdd019d055c4876a7b26ef1d9c92722ad`.
They retain product version `0.1.24`. The agent onboarding release remains
`0.1.24-91092feb27e0aa3b2993da07`; its four artifact byte counts and hashes are
unchanged. This correction changes neither public fleet/fleetd npm artifacts
nor the SQLite schema. There is no npm republish, history reset, compatibility
handler or alternate server path for this correction.
