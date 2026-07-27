using CtlFlow.Audit.Auditd.IntegrationTests.Model;

if (args.Length != 1)
{
    Console.Error.WriteLine("usage: model-audit <absolute-database-path>");
    return 2;
}

await ModelAudits.AuditModel(
    args[0],
    CancellationToken.None);
Console.WriteLine("auditd EF compiled-model audit passed");
return 0;
