using System.Diagnostics;

namespace CtlFlow.Configuration.Configd.Db;

public static class ConfigurationDbTelemetry
{
    public const string SourceName = "ctlflow.configd.db";

    public static readonly ActivitySource Source = new(SourceName);

    public static Activity? StartOperation(string operation)
    {
        var activity = Source.StartActivity(
            $"configd.db.{operation}",
            ActivityKind.Client);
        activity?.SetTag("db.system.name", "sqlite");
        activity?.SetTag("db.operation.name", operation);
        return activity;
    }
}
