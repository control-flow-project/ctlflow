namespace CtlFlow.Auth.Authd.Service.Dependencies;

internal sealed class DependencyUnavailableException(
    string dependency,
    Exception? innerException = null)
    : Exception($"Dependency unavailable: {dependency}", innerException)
{
    internal string Dependency { get; } = dependency;
}
