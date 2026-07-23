# Workspace gRPC placeholder

This directory will own request parsing, response mapping, and the
`ResolveWorkspace` gRPC operation after the shared proto advertises it.

Authentication, invocation fencing, telemetry, cache bounds, cancellation, and
status mapping must follow the proven `ResolveTenant` path without copying its
implementation.
