export async function readProbeStatus(
  probePort: number,
  path = "/readyz"
): Promise<number> {
  const response = await fetch(
    `http://127.0.0.1:${String(probePort)}${path}`);
  return response.status;
}
