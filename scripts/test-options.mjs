import { basename } from 'node:path';

export function testOptions(arguments_) {
  if (arguments_.some(argument => argument !== '--all-runtimes') || arguments_.length > 1) {
    throw new Error('The only optional test flag is --all-runtimes');
  }
  return { allRuntimes: arguments_.includes('--all-runtimes') };
}

export function runtimeTestEnabled(file, options) {
  const name = basename(file);
  const extended = /^(?:claude|pi)-/u.test(name) || name === 'native-setup.test.js';
  return options.allRuntimes || !extended;
}
