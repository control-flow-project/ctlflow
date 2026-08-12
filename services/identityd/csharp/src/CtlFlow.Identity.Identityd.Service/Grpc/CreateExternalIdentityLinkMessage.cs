using CtlFlow.Identity.Identityd.Domain.IdentityLinks;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal static partial class IdentityResponses
{
    internal static CtlFlow.Identity.V1.ExternalIdentityLink
        CreateExternalIdentityLinkMessage(ExternalIdentityLink link) => new()
        {
            TenantId = link.TenantId.Value,
            ProviderId = link.ProviderId.Value,
            ProviderSubject = link.ProviderSubject.Value,
            AccountId = link.AccountId.Value,
            Revision = checked((ulong)link.Revision.Value)
        };
}
