using CtlFlow.Packages.Pkgd.IntegrationTests.Model;

if (args.Length != 1)
{
    Console.Error.WriteLine("usage: model-audit <absolute-database-path>");
    return 2;
}

await ModelAudits.AuditPackageModel(
    args[0],
    CancellationToken.None);
Console.WriteLine("pkgd EF compiled-model audit passed");
return 0;
