namespace CtlFlow.Egress.Egressd.Service.Proxy;

internal sealed record RequestTarget(
    string Path,
    string Query);
