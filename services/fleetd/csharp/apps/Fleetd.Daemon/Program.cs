using Fleetd.Daemon;

try
{
    if (Crossfire.AdapterRuntime.NativeGuard.Requested(args)) { Environment.ExitCode = await Crossfire.AdapterRuntime.NativeGuard.Run(args); return; }
    await DaemonHost.Run(args);
}
catch (Exception error)
{
    Console.Error.WriteLine(error.Message);
    Environment.ExitCode = 1;
}
