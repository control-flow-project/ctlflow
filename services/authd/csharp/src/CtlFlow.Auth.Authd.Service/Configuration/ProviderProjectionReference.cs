namespace CtlFlow.Auth.Authd.Service.Configuration;

internal sealed record ProviderProjectionReference(
    string ConfigurationId,
    string ConfigurationVersionId,
    string SecretId,
    string SecretVersionId);
