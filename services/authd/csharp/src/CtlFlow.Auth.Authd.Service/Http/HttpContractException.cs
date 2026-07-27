namespace CtlFlow.Auth.Authd.Service.Http;

internal sealed class HttpContractException(
    int statusCode,
    string outcome)
    : Exception
{
    internal int StatusCode { get; } = statusCode;

    internal string Outcome { get; } = outcome;
}
