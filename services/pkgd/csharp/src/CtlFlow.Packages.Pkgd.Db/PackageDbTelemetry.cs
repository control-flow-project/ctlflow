using System.Diagnostics;

namespace CtlFlow.Packages.Pkgd.Db;

// Explicit ActivitySource for database operations, per telemetry.md. It is an
// ordinary BCL type with no reflection, so it stays NativeAOT-compatible. The
// Service registers this source with the tracer provider.
public static class PackageDbTelemetry
{
    public const string SourceName = "ctlflow.pkgd.db";

    public static readonly ActivitySource Source = new(SourceName);

    public static Activity? StartOperation(string operation)
    {
        var activity = Source.StartActivity(
            $"pkgd.db.{operation}",
            ActivityKind.Client);
        activity?.SetTag("db.system.name", "sqlite");
        activity?.SetTag("db.operation.name", operation);
        return activity;
    }
}
