using CtlFlow.Configuration.Configd.IntegrationTests.Model;

if (args.Length != 1)
{
    Console.Error.WriteLine("usage: model-audit <absolute-database-path>");
    return 2;
}

await ModelAudits.AuditConfigurationModel(
    args[0],
    CancellationToken.None);
Console.WriteLine("configd EF compiled-model audit passed");
return 0;
