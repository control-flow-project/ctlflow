using CtlFlow.Policy.Policyd.IntegrationTests.Model;

if (args.Length != 1)
{
    Console.Error.WriteLine("usage: model-audit <absolute-database-path>");
    return 2;
}

await ModelAudits.AuditPolicyModel(
    args[0],
    CancellationToken.None);
Console.WriteLine("policyd EF compiled-model audit passed");
return 0;
