using Crossfire.Server;

try
{
    if (args is ["health"]) await ContainerHealth.Verify();
    else if (args.Length == 0 || args[0] is "init" or "--help") await ServerOperator.Run(args);
    else await ServerHost.Run(ServerHost.Arguments(args));
}
catch (Exception error) { Console.Error.WriteLine(error.Message); Environment.ExitCode = 1; }
