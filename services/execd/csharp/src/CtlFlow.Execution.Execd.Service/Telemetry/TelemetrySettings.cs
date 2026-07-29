namespace CtlFlow.Execution.Execd.Service.Telemetry;

internal sealed record TelemetrySettings(Uri OtlpEndpoint)
{
    internal Uri LogsEndpoint => CreateSignalEndpoint("logs");

    internal Uri MetricsEndpoint => CreateSignalEndpoint("metrics");

    internal Uri TracesEndpoint => CreateSignalEndpoint("traces");

    internal static TelemetrySettings Parse(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var endpoint)
            || endpoint.Scheme is not ("http" or "https")
            || !string.IsNullOrEmpty(endpoint.UserInfo)
            || !string.IsNullOrEmpty(endpoint.Query)
            || !string.IsNullOrEmpty(endpoint.Fragment))
        {
            throw new InvalidOperationException(
                "OTEL_EXPORTER_OTLP_ENDPOINT must be a canonical HTTP or HTTPS URL");
        }

        return new TelemetrySettings(endpoint);
    }

    private Uri CreateSignalEndpoint(string signal) =>
        new(
            $"{OtlpEndpoint.AbsoluteUri.TrimEnd('/')}/v1/{signal}",
            UriKind.Absolute);
}
