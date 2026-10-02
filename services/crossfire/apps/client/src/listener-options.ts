import { option, type Arguments } from '@crossfire/adapter-matrix/commands';
import { integerOption } from '@crossfire/contracts/limits';

export function listenerOptions(values: Arguments) {
  return {
    pollMs: integerOption(option(values, 'poll-ms'), 10_000, 100, 30_000, '--poll-ms'),
    debounceMs: integerOption(option(values, 'debounce-ms'), 10_000, 0, 60_000, '--debounce-ms'),
    reconcileMs: integerOption(option(values, 'reconcile-ms'), 120_000, 1000, 600_000, '--reconcile-ms'),
  };
}
