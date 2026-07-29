using CtlFlow.Execution.Execd.IntegrationTests.Model;

if (args.Length != 1)
{
    Console.Error.WriteLine("usage: model-audit <absolute-database-path>");
    return 2;
}

await ModelAudits.AuditExecutionModel(
    args[0],
    CancellationToken.None);
Console.WriteLine("execd EF compiled-model audit passed");
return 0;
