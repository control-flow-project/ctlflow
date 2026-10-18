using Fleetd.Daemon;

if (Crossfire.AdapterRuntime.NativeGuard.Requested(args)) { Environment.ExitCode = await Crossfire.AdapterRuntime.NativeGuard.Run(args); return; }
await DaemonHost.Run(args);
