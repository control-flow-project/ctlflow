using static CtlFlow.Egress.Egressd.Service.Hosting.EgressdProcess;

try
{
    return await RunEgressd(args);
}
catch (Exception)
{
    Console.Error.WriteLine("Egressd startup failed.");
    return 1;
}
