using CtlFlow.Configuration.Configd.Db.Content;
using CtlFlow.Configuration.Configd.Domain.Configurations;

namespace CtlFlow.Configuration.Configd.Service.Grpc.Requests;

internal sealed record ParsedConfigurationPublication(
    ConfigurationDraft Draft,
    ConfigurationContentLease Content) : IDisposable
{
    public void Dispose() => Content.Dispose();
}
