export function testOptions(arguments_) {
  if (arguments_.length) throw new Error('Runtime flags are unsupported: Codex is the only implemented runtime');
}
