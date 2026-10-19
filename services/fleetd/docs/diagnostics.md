# Diagnostic API

`GET /api/diagnostics` is an authenticated private-socket operation. Optional
`fleetId` and `instanceKey` query parameters select an existing fleet/agent.
An instance requires a fleet. Unknown/duplicate fields, invalid identities and
missing targets are rejected. This route has no browser/anonymous exception.

```json
{
  "checkedAt": 1792368000000,
  "scope": { "fleetId": null, "instanceKey": null },
  "checks": [
    {
      "id": "controller.connection",
      "scope": { "fleetId": null, "instanceKey": null },
      "status": "pass",
      "observedAt": 1792368000000,
      "message": "Authenticated controller API is reachable",
      "remediation": null
    }
  ]
}
```

The example is the data object inside the ordinary response envelope, not a
complete controller report. The canonical executable schema is in fleetd's
contracts package. All three language implementations expose the same contract.

fleet owns transport/presentation. fleetd projects its registry, activation,
connection and native lifecycle observations. The existing crossfire connection
owner supplies connection/delivery state; no new server collector, database,
scheduler or diagnostic endpoint on crossfire is required. Runtime adapters own
provider-specific inspection through the owned-runtime port.

Each check has its own scope and observation time. Missing evidence is unknown.
The scope is limited to the existing 100-instance fleet roster. At most four
provider probes run concurrently, five seconds each, within a 20-second report
deadline. Invalid configuration produces a finding and leaves dependent facts
unknown. Other independent checks continue.

Inspection never calls start, resume, reset, native admission, readiness, receipt
settlement or checkpoint clearing. It neither renews provider credentials nor
performs inference. A changed/closed running-agent owner invalidates its probe.
Probe failures do not trigger lifecycle recovery. A cancelled Pi metadata request
is retired without a later destructive native-command timeout; started protocol
frames finish atomically instead of being truncated by the diagnostic timeout.

Reports omit secrets, account identities, raw exception/log bodies, host paths,
configuration contents and histories. Existing retained-history/connection facts
are labeled as observations, not fresh filesystem/provider certification. No
diagnostic report is persisted. The caller may retain the bounded JSON output.

- [CLI usage, statuses and limits](https://github.com/control-flow-project/ctlflow/blob/main/services/fleet/docs/diagnostics.md)
- [Controller operations](operations.md)
