using Crossfire.Server;

if (args.Length == 0 || args[0] is "init" or "start" or "--help") await ServerOperator.Run(args);
else await ServerHost.Run(ServerHost.Arguments(args));
