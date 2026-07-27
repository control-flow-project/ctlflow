using System.Diagnostics;

namespace CtlFlow.Audit.Auditd.Db;

public static class AuditDbTelemetry
{
    public const string SourceName = "ctlflow.auditd.db";

    public static readonly ActivitySource Source = new(SourceName);

    public static Activity? StartOperation(string operation)
    {
        var activity = Source.StartActivity(
            $"auditd.db.{operation}",
            ActivityKind.Client);
        activity?.SetTag("db.system.name", "sqlite");
        activity?.SetTag("db.operation.name", operation);
        return activity;
    }
}
