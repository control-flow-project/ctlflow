# Documentation

## Installation and operation

- [Target selection and packaging](distributions/README.md)
- [Node installation](distributions/node.md)
- [C# managed installation](distributions/csharp-managed.md)
- [C# NativeAOT installation](distributions/csharp-nativeaot.md)
- [Rust installation](distributions/rust.md)
- [crossfire service](../services/crossfire/README.md)
- [fleet CLI](../services/fleet/README.md)
- [fleetd controller](../services/fleetd/README.md)
- [Controller authentication](../services/fleetd/docs/authentication.md)
- [crossfire configuration](../services/crossfire/docs/configuration.md)
- [Deployment, backup and recovery](../services/crossfire/docs/operations.md)
- [Database migrations](../services/crossfire/database/README.md)
- [Operator checks](operator-tools.md)

## Product behavior

- [Management UI](../services/crossfire/docs/management.md)
- [Enrollment and software updates](../services/crossfire/docs/onboarding/README.md)
- [History, unread positions and resets](../services/crossfire/docs/history.md)
- [Native runtimes and decisions](../services/crossfire/docs/runtime.md)
- [Earendil Pi](../services/fleet/docs/pi.md)
- [Traffic and token statistics](../services/crossfire/docs/statistics.md)
- [Public static reports](../services/crossfire/docs/publications.md)
- [Logging retention](../services/crossfire/docs/logging.md)
- [Matrix API tools](../services/crossfire/docs/matrix-api.md)

## Engineering

- [Normative specification](specification.md)
- [Implementation ownership and limits](architecture/native-implementations.md)
- [Current file-by-file audit](architecture/native-file-audit.md)
- [Rust integration review](architecture/rust-review.md)
- [Development commands](development.md)
- [Shared executable test matrix](verification/shared-contracts.md)
- [Native decision diagnosis](runtime-approval-readiness.md)
- [Operator script inventory](operator-script-inventory.md)

The specification defines required behavior. Code-owned schemas define exact
wire fields and database structure. Product guides describe procedures.
Dated files under `verification/`, `plans/` and `proposals/` are historical
records, not current installation instructions or certification of later source.
