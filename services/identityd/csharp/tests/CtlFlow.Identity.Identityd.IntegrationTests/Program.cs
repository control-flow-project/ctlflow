using CtlFlow.Identity.Identityd.IntegrationTests.Model;

if (args.Length != 1)
{
    Console.Error.WriteLine("usage: model-audit <absolute-database-path>");
    return 2;
}

await ModelAudits.AuditIdentityModel(
    args[0],
    CancellationToken.None);
Console.WriteLine("identityd EF compiled-model audit passed");
return 0;
