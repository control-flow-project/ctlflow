namespace CtlFlow.Audit.Auditd.Domain.Events;

public enum AuditAttributionKind
{
    Operator = 1,
    Workload = 2,
    Invocation = 3
}

public enum AuditPartitionKind
{
    Global = 1,
    Tenant = 2
}

public enum AuditDetailKind
{
    TenantMutation = 1,
    WorkspaceMutation = 2,
    IdentitySession = 3,
    PackageDeclaration = 4,
    AppMutation = 5,
    ConfigurationPublication = 6,
    SecretPublication = 7,
    ProjectionMutation = 8,
    PlacementMutation = 9,
    WorkloadMutation = 10,
    RunMutation = 11,
    IdentityMembership = 12,
    IdentityGroup = 13,
    IdentityGroupMember = 14,
    IdentityVirtualPrincipal = 15,
    IdentityExternalLink = 16,
    IdentityLoginProvider = 17,
    IdentityWorkspaceProviderAdmission = 18
}

public enum PlacementTargetKind
{
    Global = 1,
    Tenant = 2,
    Workspace = 3,
    User = 4
}

public enum ProjectionTargetKind
{
    Configuration = 1,
    Secret = 2
}

public enum TenantAuditAction
{
    Create = 1,
    Update = 2,
    SetState = 3
}

public enum WorkspaceAuditAction
{
    Create = 1,
    Update = 2,
    SetState = 3
}

public enum TenancyAuditState
{
    Active = 1,
    Suspended = 2,
    Deleted = 3
}

public enum IdentitySessionAuditAction
{
    Created = 1,
    Revoked = 2
}

public enum IdentityMembershipAuditAction
{
    Added = 1,
    Removed = 2
}

public enum IdentityGroupAuditAction
{
    Created = 1,
    Deleted = 2
}

public enum IdentityGroupMemberAuditAction
{
    Added = 1,
    Removed = 2
}

public enum IdentityVirtualPrincipalAuditAction
{
    Created = 1,
    EnabledStateChanged = 2
}

public enum IdentityExternalLinkAuditAction
{
    Created = 1,
    Deleted = 2
}

public enum IdentityLoginProviderAuditAction
{
    Created = 1,
    Updated = 2,
    StateChanged = 3
}

public enum IdentityLoginProviderAuditState
{
    Active = 1,
    Disabled = 2,
    Deleted = 3
}

public enum IdentityWorkspaceProviderAdmissionAuditAction
{
    Admitted = 1,
    Removed = 2
}

public enum AppAuditAction
{
    Created = 1,
    PackageGenerationChanged = 2
}

public enum ProjectionAuditAction
{
    Created = 1,
    VersionChanged = 2
}

public enum PlacementAuditAction
{
    Declared = 1,
    Updated = 2
}

public enum WorkloadAuditAction
{
    Declared = 1,
    Updated = 2
}

public enum RunAuditAction
{
    Created = 1,
    CancellationRequested = 2
}

public enum ExecutionAuditState
{
    Active = 1,
    Suspended = 2,
    Retired = 3
}
