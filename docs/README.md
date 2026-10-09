# Documentation

## Using the products
- [Crossfire guide index](../services/crossfire/docs/README.md)
- [Fleet guide index](../services/fleet/docs/README.md)
- [Controller guide index](../services/fleetd/docs/README.md)

## Engineering
- [Development and verification](development.md)
- [Operator verification tools](operator-tools.md)
- [Reusable operator check inventory](operator-script-inventory.md)
- [Canonical specification](specification.md)
- [Runtime approval diagnosis and native dependency evidence](runtime-approval-readiness.md)
- [Native feasibility and verification boundaries](../services/crossfire/docs/architecture/feasibility.md)

## Architecture evidence
- [WCBUBWHB cleanup and exact native settings review](verification/20261009-canonical-cleanup.md)
- [Listener, sleep and report-publication review](proposals/20261005-listener-and-publication-architecture.md)
- [Universal fleet controller verification](verification/20261005-universal-fleet-controller.md)
- [Preserving GAAP rollout verification](verification/20261006-gaap-preserving-rollout.md)
- [Fleet stop and management navigation](verification/20261007-fleet-stop-management.md)
- [High-first Agreements rollout verification](verification/20261006-high-first-agreements.md)

The review records the inspected baseline and the current managed design. It is
not a second specification or proof of deployment. fleetd owns the shared listener;
the default native idle-sleep timeout is 30 minutes.

The specification owns architecture, schemas, authorization and REST contracts.
Product guides describe operator and user workflows. Runtime defaults and
overrides are documented in the fleet configuration guide. Every Crossfire agent
is fleet-managed. The coding session performing setup remains independent and
retains its own native settings.
