using System.Diagnostics;

namespace CtlFlow.Tenancy.Tenantd.Db;

// Explicit ActivitySource for database operations, per telemetry.md. It is an
// ordinary BCL type with no reflection, so it stays NativeAOT-compatible. The
// Service registers this source with the tracer provider.
public static class TenantDbTelemetry
{
    public const string SourceName = "ctlflow.tenantd.db";

    public static readonly ActivitySource Source = new(SourceName);

    public static Activity? StartQuery(string operation)
    {
        var activity = Source.StartActivity(operation, ActivityKind.Client);
        activity?.SetTag("db.system", "sqlite");
        return activity;
    }
}
