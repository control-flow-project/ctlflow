namespace CtlFlow.Auth.Authd.Service.Http;

internal sealed class HttpContractException(
    int statusCode,
    string outcome,
    string dependency = "none")
    : Exception
{
    internal int StatusCode { get; } = statusCode;

    internal string Outcome { get; } = outcome;

    internal string Dependency { get; } = dependency;
}
