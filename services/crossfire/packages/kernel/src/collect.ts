export async function collect(source: AsyncIterable<Uint8Array>, maximum: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error('Invalid finite response byte limit');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > maximum) throw Object.assign(new Error('Response exceeds its finite byte limit'), { code: 'body_too_large' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
