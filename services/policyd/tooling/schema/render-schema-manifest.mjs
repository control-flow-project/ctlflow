export function renderSchemaManifest(migrations) {
  return `${migrations
    .map(({ name, digest }) => `${name}\t${digest}`)
    .join("\n")}\n`;
}
