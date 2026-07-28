using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;
using CtlFlow.Configuration.Configd.Domain.Secrets;
using CtlFlow.Configuration.V1;
using static CtlFlow.Configuration.Configd.Db.Custody.SecretCustody;

namespace CtlFlow.Configuration.Configd.Service.Grpc.Requests;

internal static partial class ConfigdRequests
{
    internal static async ValueTask<ParsedSecretPublication>
        CreateSecretPublication(
            PublishSecretRequest request,
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
        var material = await CreateSecretMaterial(
            request.Material.Memory,
            cancellation);
        try
        {
            return new ParsedSecretPublication(
                new SecretDraft(
                    SecretId.Parse(request.SecretId),
                    SecretVersionId.Parse(request.SecretVersionId),
                    binding,
                    request.HasExpectedRevision
                        ? Revision.Parse(request.ExpectedRevision)
                        : null,
                    claim),
                material);
        }
        catch
        {
            material.Dispose();
            throw;
        }
    }
}
