import { acquireProcessLock } from '@crossfire/adapter-filesystem/lock';
await acquireProcessLock(process.argv[2]!);
process.send?.({ ready: true });
setInterval(() => {}, 60000);
