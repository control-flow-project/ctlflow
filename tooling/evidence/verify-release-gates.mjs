export function verifyReleaseGates(
  actual,
  service,
  durable
) {
  const expected = [
    `npm run build:${service}`,
    `npm run test:compiled --workspace @ctlflow/${service}`,
    ...(durable
      ? [`npm run test:csharp --workspace @ctlflow/${service}`]
      : []),
    `npm run verify:container:${service}`,
    ...(durable
      ? [`npm run verify:migration-container:${service}`]
      : [])
  ];
  if (!Array.isArray(actual)
      || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${service} release gates mismatch: expected `
      + expected.join(", "));
  }
}
