using CtlFlow.Identity.Identityd.Domain.Principals;

namespace CtlFlow.Identity.Identityd.Service.Grpc;

internal static partial class IdentityResponses
{
    internal static CtlFlow.Identity.V1.PrincipalKind MapPrincipalKind(
        Domain.Principals.PrincipalKind kind) => kind switch
        {
            PrincipalKind.Human =>
                CtlFlow.Identity.V1.PrincipalKind.Human,
            PrincipalKind.Service =>
                CtlFlow.Identity.V1.PrincipalKind.Service,
            PrincipalKind.Virtual =>
                CtlFlow.Identity.V1.PrincipalKind.Virtual,
            _ => throw new InvalidOperationException(
                "Principal kind is not supported")
        };
}
