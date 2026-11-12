using Fleetd.Daemon;

try
{
    if (Crossfire.AdapterRuntime.NativeGuard.Requested(args)) { Environment.ExitCode = await Crossfire.AdapterRuntime.NativeGuard.Run(args); return; }
    if (Fleetd.AdapterExecution.Vm.Supervisor.Requested(args)) { await Fleetd.AdapterExecution.Vm.Supervisor.Run(args); return; }
    await DaemonHost.Run(args);
}
catch (Exception error)
{
    Console.Error.WriteLine(error.Message);
    Environment.ExitCode = 1;
}
