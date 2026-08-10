using CtlFlow.Audit.Auditd.Domain.Details;
using CtlFlow.Audit.Auditd.Domain.Events;

namespace CtlFlow.Audit.Auditd.Domain.Validation;

internal static partial class AuditValidation
{
    internal static void ValidateAuditDetail(AuditDetail detail)
    {
        switch (detail)
        {
            case TenantMutationAuditDetail value:
                ValidateTenantMutation(value);
                break;
            case WorkspaceMutationAuditDetail value:
                ValidateWorkspaceMutation(value);
                break;
            case IdentitySessionAuditDetail value:
                ValidateIdentitySession(value);
                break;
            case IdentityMembershipAuditDetail value:
                ValidateIdentityMembership(value);
                break;
            case IdentityGroupAuditDetail value:
                ValidateIdentityGroup(value);
                break;
            case IdentityGroupMemberAuditDetail value:
                ValidateIdentityGroupMember(value);
                break;
            case IdentityVirtualPrincipalAuditDetail value:
                ValidateIdentityVirtualPrincipal(value);
                break;
            case IdentityExternalLinkAuditDetail value:
                ValidateIdentityExternalLink(value);
                break;
            case IdentityLoginProviderAuditDetail value:
                ValidateIdentityLoginProvider(value);
                break;
            case IdentityWorkspaceProviderAdmissionAuditDetail value:
                ValidateIdentityWorkspaceProviderAdmission(value);
                break;
            case PackageDeclarationAuditDetail value:
                ValidatePackageDeclaration(value);
                break;
            case AppMutationAuditDetail value:
                ValidateAppMutation(value);
                break;
            case ConfigurationPublicationAuditDetail value:
                ValidateConfigurationPublication(value);
                break;
            case SecretPublicationAuditDetail value:
                ValidateSecretPublication(value);
                break;
            case ProjectionMutationAuditDetail value:
                ValidateProjectionMutation(value);
                break;
            case PlacementMutationAuditDetail value:
                ValidatePlacementMutation(value);
                break;
            case WorkloadMutationAuditDetail value:
                ValidateWorkloadMutation(value);
                break;
            case RunMutationAuditDetail value:
                ValidateRunMutation(value);
                break;
            default:
                throw new ArgumentException("Audit detail is invalid");
        }
    }
}
