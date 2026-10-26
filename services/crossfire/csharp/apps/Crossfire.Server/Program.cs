using Crossfire.Server;

if (args is ["health"]) await ContainerHealth.Verify();
else if (args.Length == 0 || args[0] is "init" or "--help")
{
    try { await ServerOperator.Run(args); }
    catch (Exception error) { Console.Error.WriteLine(error.Message); Environment.ExitCode = 1; }
}
else await ServerHost.Run(ServerHost.Arguments(args));
