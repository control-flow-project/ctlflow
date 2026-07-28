using CtlFlow.Configuration.Configd.Domain.Configurations;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;
using CtlFlow.Configuration.V1;
using static CtlFlow.Configuration.Configd.Db.Content.ConfigurationContents;

namespace CtlFlow.Configuration.Configd.Service.Grpc.Requests;

internal static partial class ConfigdRequests
{
    internal static async ValueTask<ParsedConfigurationPublication>
        CreateConfigurationPublication(
            PublishConfigurationRequest request,
            CancellationToken cancellation)
    {
        var binding = await CreateConsumerBinding(
            request.Binding,
            cancellation);
        var claim = await CreateDependencyClaimSelector(
            request.HasDependencyClaimId,
            request.DependencyClaimId,
            request.HasDependencyClaimRevision,
            request.DependencyClaimRevision,
            cancellation);
        var content = await CreateConfigurationContent(
            request.ContentJson.Memory,
            cancellation);
        try
        {
            return new ParsedConfigurationPublication(
                new ConfigurationDraft(
                    ConfigurationId.Parse(request.ConfigurationId),
                    ConfigurationVersionId.Parse(
                        request.ConfigurationVersionId),
                    binding,
                    request.HasExpectedRevision
                        ? Revision.Parse(request.ExpectedRevision)
                        : null,
                    content.Reference,
                    claim),
                content);
        }
        catch
        {
            content.Dispose();
            throw;
        }
    }
}
