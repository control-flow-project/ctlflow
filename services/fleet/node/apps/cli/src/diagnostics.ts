import { join } from 'node:path';
import { createDaemonClient, operations } from '@ctlflow/fleet-daemon-client/client';
import { openTunnel } from '@ctlflow/fleet-ssh-transport/tunnel';
import { readAuthentication } from '@ctlflow/fleetd-storage/authentication';
import type { Parsed } from '@ctlflow/crossfire-contracts/schema/validation';
import type { diagnosticReport } from '@ctlflow/fleetd-contracts/diagnostics';
import { listFleets } from './operation.js';

type Report = Parsed<typeof diagnosticReport>;
export async function diagnose(root: string, remote: { ssh: string } | undefined, fleetKey: string | undefined,
  instanceKey: string | undefined, signal: AbortSignal): Promise<Report> {
  const scope = { fleetId: null, instanceKey: null }, checkedAt = Date.now();
  let tunnel: Awaited<ReturnType<typeof openTunnel>> | undefined;
  const cancellation = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
  function unavailable(authentication: boolean): Report {
    return { checkedAt, scope, checks: [
      { id: 'controller.connection', scope, status: authentication ? 'unknown' : 'fail', observedAt: checkedAt,
        message: authentication ? 'Controller diagnostics require the mandatory authentication key' : 'Selected controller API is unreachable; its cause and native process state are unknown',
        remediation: authentication ? 'Check the shared private fleetd authentication configuration; diagnostics never creates or replaces it' : 'Check the selected computer, controller process and socket; start fleetd explicitly if stopped' },
      { id: 'controller.authentication', scope, status: authentication ? 'fail' : 'unknown', observedAt: authentication ? checkedAt : null,
        message: authentication ? 'Authentication could not be read or was refused' : 'Controller authentication could not be verified', remediation: null },
      { id: 'fleet.state', scope, status: 'unknown', observedAt: null, message: 'Fleet and native state cannot be inspected without the authenticated controller', remediation: null },
    ] };
  }
  try {
    try { if (remote) tunnel = await openTunnel(remote.ssh, root, cancellation); }
    catch { return unavailable(false); }
    const client = createDaemonClient(tunnel?.socketPath ?? join(root, 'fleetd.sock'), cancellation, () => tunnel ? tunnel.authenticationKey : readAuthentication());
    const controller = await client.call(operations.diagnostics, {}, {});
    if (!controller.ok) return unavailable(controller.error.code === 'unauthorized' || controller.error.code === 'forbidden');
    if (!fleetKey) return controller.value.data;
    let fleets: Awaited<ReturnType<typeof listFleets>>;
    try { fleets = await listFleets(client); } catch { return unavailable(false); }
    const fleet = fleets.find(item => item.fleetKey === fleetKey || item.fleetId === fleetKey);
    if (!fleet) throw new Error('Fleet not found: ' + fleetKey);
    const query = new URLSearchParams({ fleetId: fleet.fleetId, ...(instanceKey ? { instanceKey } : {}) });
    const report = await client.call(operations.diagnostics, {}, {}, query);
    if (!report.ok) {
      if (report.error.code === 'unavailable' || report.error.code === 'unauthorized' || report.error.code === 'forbidden') return unavailable(report.error.code !== 'unavailable');
      throw new Error(report.error.code + ': ' + report.error.message);
    }
    return report.value.data;
  } finally { await tunnel?.close(); }
}
