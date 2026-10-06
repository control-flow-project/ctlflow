import { command } from '@ctlflow/crossfire-operator-support/process';
import { fingerprint } from '@ctlflow/crossfire-operator-support/files';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';

export const hostPlan = check.object({ container: check.refine(check.text(255), value => /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u.test(value), 'Expected an exact container name or ID'),
  image: check.refine(check.text(255), value => !value.startsWith('-') && !/\s/u.test(value), 'Expected an exact image reference'),
  labels: check.optional(input => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return failure('invalid', 'Expected image label pairs');
    const labels: Record<string, string> = {};
    for (const [name, value] of Object.entries(input)) {
      if (!check.text(255)(name).ok || !check.text(4096)(value).ok) return failure('invalid', 'Invalid image label');
      labels[name] = String(value);
    }
    return success(labels);
  }) });
const container = check.object({ image: check.text(255), healthy: check.boolean, readOnly: check.boolean, privileged: check.boolean, capDrop: check.list(check.text(100), 100),
  security: check.list(check.text(255), 100), bindings: check.list(check.object({ address: check.text(255), port: check.text(10) }), 100) });

export async function verifyHost(plan: check.Parsed<typeof hostPlan>, signal: AbortSignal) {
  const info = await command('docker', ['info', '--format', '{{json .SecurityOptions}}'], signal);
  if (!info.ok) return info;
  const inspected = await command('docker', ['inspect', '--format', '{{json .}}', '--', plan.container], signal);
  if (!inspected.ok) return inspected;
  try {
    const value = JSON.parse(inspected.value) as { Config: { Image: string }; State: { Health?: { Status: string } }; HostConfig: { ReadonlyRootfs: boolean; Privileged: boolean; CapDrop: string[]; SecurityOpt: string[] }; NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[] | null> } };
    const checked = container({ image: value.Config.Image, healthy: value.State.Health?.Status === 'healthy', readOnly: value.HostConfig.ReadonlyRootfs,
      privileged: value.HostConfig.Privileged, capDrop: value.HostConfig.CapDrop, security: value.HostConfig.SecurityOpt,
      bindings: Object.values(value.NetworkSettings.Ports).flatMap(ports => (ports ?? []).map(port => ({ address: port.HostIp, port: port.HostPort }))) });
    if (!checked.ok) return checked;
    const details = checked.value;
    if (!(JSON.parse(info.value) as unknown[]).includes('name=rootless') || details.image !== plan.image || !details.healthy || !details.readOnly || details.privileged
      || !details.capDrop.includes('ALL') || !details.security.includes('no-new-privileges:true')
      || details.bindings.some(binding => !['127.0.0.1', '::1'].includes(binding.address))) return failure('conflict', 'Container provenance, health or isolation differs from the required contract');
    const image = await command('docker', ['image', 'inspect', '--format', '{{json .Config.Labels}}', '--', plan.image], signal);
    if (!image.ok) return image;
    const labels: unknown = JSON.parse(image.value);
    if (!labels || typeof labels !== 'object') return failure('native', 'Image labels are invalid');
    for (const [name, expected] of Object.entries(plan.labels ?? {})) if (!(name in labels) || Reflect.get(labels, name) !== expected) return failure('conflict', 'Expected image provenance label differs: ' + name);
    return success({ container: plan.container, ...details, rootless: true, expectedLabelsVerified: Object.keys(plan.labels ?? {}).length });
  } catch { return failure('native', 'Docker returned invalid inspection data'); }
}

export async function verifyArchive(file: string, sha256: string, signal: AbortSignal) {
  if (!/^[a-f0-9]{64}$/u.test(sha256)) return failure('invalid', 'Supply the exact expected SHA-256');
  const actual = fingerprint(file); if (!actual.ok) return actual;
  if (actual.value.sha256 !== sha256) return failure('conflict', 'Archive checksum mismatch');
  const listed = await command('tar', ['-tzf', file], signal); if (!listed.ok) return listed;
  const entries = listed.value.trim().split('\n');
  if (!entries.length || entries.some(entry => !entry || entry.startsWith('/') || entry.split('/').includes('..'))) return failure('invalid', 'Archive member listing is empty or unsafe');
  return success({ archive: file, ...actual.value, readableEntries: entries.length, checkedAt: new Date().toISOString(), extracted: false });
}
