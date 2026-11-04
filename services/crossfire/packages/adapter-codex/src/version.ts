import manifest from '../package.json' with { type: 'json' };

export const codexClientVersion: string = manifest.version;
