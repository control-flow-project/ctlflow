using System.Diagnostics;

namespace CtlFlow.Identity.Identityd.Db;

public static class IdentityDbTelemetry
{
    public const string SourceName = "ctlflow.identityd.db";

    public static readonly ActivitySource Source = new(SourceName);

    public static Activity? StartOperation(string operation)
    {
        var activity = Source.StartActivity(
            $"identityd.db.{operation}",
            ActivityKind.Client);
        activity?.SetTag("db.system.name", "sqlite");
        activity?.SetTag("db.operation.name", operation);
        return activity;
    }
}
