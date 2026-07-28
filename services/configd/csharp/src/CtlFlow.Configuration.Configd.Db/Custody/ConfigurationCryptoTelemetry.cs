using System.Diagnostics;

namespace CtlFlow.Configuration.Configd.Db.Custody;

public static class ConfigurationCryptoTelemetry
{
    public const string SourceName = "ctlflow.configd.crypto";

    private static readonly ActivitySource Source = new(SourceName);

    internal static Activity? StartOperation(string operation)
    {
        var activity = Source.StartActivity(
            $"configd.crypto.{operation}",
            ActivityKind.Internal);
        activity?.SetTag("ctlflow.operation", operation);
        return activity;
    }

    internal static void Complete(Activity? activity, bool succeeded)
    {
        var outcome = succeeded ? "OK" : "ERROR";
        activity?.SetTag("ctlflow.outcome", outcome);
        activity?.SetStatus(
            succeeded
                ? ActivityStatusCode.Ok
                : ActivityStatusCode.Error);
    }
}
