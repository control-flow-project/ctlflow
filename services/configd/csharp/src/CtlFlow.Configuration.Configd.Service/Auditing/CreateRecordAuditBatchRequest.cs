using CtlFlow.Audit.V1;
using CtlFlow.Configuration.Configd.Domain.Auditing;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Projections;
using Google.Protobuf.WellKnownTypes;
using DomainAuditAttribution =
    CtlFlow.Configuration.Configd.Domain.Auditing.AuditAttribution;

namespace CtlFlow.Configuration.Configd.Service.Auditing;

internal static partial class AuditDelivery
{
    internal static ValueTask<RecordAuditBatchRequest>
        CreateRecordAuditBatchRequest(
            ConfigdAuditIntent intent,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var envelope = intent.Envelope;
        var auditEvent = new AuditEvent
        {
            SourceEventId = envelope.EventId.Value,
            OccurredAt = Timestamp.FromDateTimeOffset(
                envelope.OccurredAt.Value),
            Attribution = CreateAttribution(envelope.Attribution),
            Partition = CreatePartition(intent),
            TraceId = envelope.TraceId.Value,
            SpanId = envelope.SpanId.Value
        };

        switch (intent)
        {
            case PublicationAuditIntent publication
                when publication.Target
                    is ProjectionTarget.Configuration configuration:
                auditEvent.ConfigurationPublication =
                    new ConfigurationPublicationAuditDetail
                    {
                        Target = new ConfigurationVersionAuditTarget
                        {
                            ConfigurationId =
                                configuration.ConfigurationId.Value,
                            ConfigurationVersionId =
                                configuration.VersionId.Value
                        },
                        Binding = CreateBinding(publication.Binding),
                        IdentityRevision = checked(
                            (ulong)publication.IdentityRevision.Value)
                    };
                AddClaim(
                    auditEvent.ConfigurationPublication,
                    publication);
                break;
            case PublicationAuditIntent publication
                when publication.Target is ProjectionTarget.Secret secret:
                auditEvent.SecretPublication =
                    new SecretPublicationAuditDetail
                    {
                        Target = new SecretVersionAuditTarget
                        {
                            SecretId = secret.SecretId.Value,
                            SecretVersionId = secret.VersionId.Value
                        },
                        Binding = CreateBinding(publication.Binding),
                        IdentityRevision = checked(
                            (ulong)publication.IdentityRevision.Value)
                    };
                AddClaim(auditEvent.SecretPublication, publication);
                break;
            case ProjectionAuditIntent projection:
                auditEvent.ProjectionMutation =
                    CreateProjectionDetail(projection);
                break;
            default:
                throw new InvalidOperationException(
                    "Configd audit intent is invalid");
        }

        var request = new RecordAuditBatchRequest();
        request.Events.Add(auditEvent);
        return ValueTask.FromResult(request);
    }

    private static CtlFlow.Audit.V1.AuditAttribution CreateAttribution(
        DomainAuditAttribution attribution) =>
        attribution switch
        {
            DomainAuditAttribution.Operator item =>
                new CtlFlow.Audit.V1.AuditAttribution
                {
                    OperatorCommonName = item.CommonName.Value
                },
            DomainAuditAttribution.Workload item =>
                new CtlFlow.Audit.V1.AuditAttribution
                {
                    WorkloadSubject = item.Subject.Value
                },
            DomainAuditAttribution.Invocation item =>
                new CtlFlow.Audit.V1.AuditAttribution
                {
                    Invocation = new InvocationAuditAttribution
                    {
                        ActorPrincipalId = item.ActorPrincipal.Value,
                        AttachedAccountPrincipalId =
                            item.AttachedAccountPrincipal.Value,
                        WorkloadSubject = item.WorkloadSubject.Value
                    }
                },
            _ => throw new InvalidOperationException(
                "Configd audit attribution is invalid")
        };

    private static AuditPartition CreatePartition(ConfigdAuditIntent intent)
    {
        var binding = intent switch
        {
            PublicationAuditIntent publication => publication.Binding,
            ProjectionAuditIntent projection => projection.Binding,
            _ => throw new InvalidOperationException(
                "Configd audit intent is invalid")
        };
        return binding.Placement.Scope switch
        {
            PlacementScope.Global => new AuditPartition
            {
                Global = new GlobalAuditPartition()
            },
            PlacementScope.Tenant tenant => CreateTenantPartition(
                tenant.TenantId.Value),
            PlacementScope.Workspace workspace => CreateTenantPartition(
                workspace.TenantId.Value),
            PlacementScope.User user => CreateTenantPartition(
                user.TenantId.Value),
            _ => throw new InvalidOperationException(
                "Placement scope is invalid")
        };
    }

    private static AuditPartition CreateTenantPartition(string tenantId) =>
        new()
        {
            Tenant = new TenantAuditPartition { TenantId = tenantId }
        };

    private static ConsumerBindingAuditDetail CreateBinding(
        ConsumerBinding binding) =>
        new()
        {
            PlacementId = binding.Placement.PlacementId.Value,
            PlacementTarget = CreatePlacementTarget(
                binding.Placement.Scope),
            ConsumerId = binding.ConsumerId.Value,
            Purpose = binding.Purpose.Value
        };

    private static PlacementAuditTarget CreatePlacementTarget(
        PlacementScope scope) =>
        scope switch
        {
            PlacementScope.Global => new PlacementAuditTarget
            {
                Global = new GlobalPlacementAuditTarget()
            },
            PlacementScope.Tenant tenant => new PlacementAuditTarget
            {
                Tenant = new TenantPlacementAuditTarget
                {
                    TenantId = tenant.TenantId.Value
                }
            },
            PlacementScope.Workspace workspace => new PlacementAuditTarget
            {
                Workspace = new WorkspacePlacementAuditTarget
                {
                    TenantId = workspace.TenantId.Value,
                    WorkspaceId = workspace.WorkspaceId.Value
                }
            },
            PlacementScope.User user => new PlacementAuditTarget
            {
                User = new UserPlacementAuditTarget
                {
                    TenantId = user.TenantId.Value,
                    AccountPrincipalId = user.AccountPrincipalId.Value
                }
            },
            _ => throw new InvalidOperationException(
                "Placement scope is invalid")
        };

    private static ProjectionMutationAuditDetail CreateProjectionDetail(
        ProjectionAuditIntent intent)
    {
        var detail = new ProjectionMutationAuditDetail
        {
            ProjectionId = intent.ProjectionId.Value,
            Action = intent.Action switch
            {
                ProjectionAuditAction.Created =>
                    ProjectionMutationAction.Created,
                ProjectionAuditAction.VersionChanged =>
                    ProjectionMutationAction.VersionChanged,
                _ => throw new InvalidOperationException(
                    "Projection audit action is invalid")
            },
            ProjectionRevision = checked(
                (ulong)intent.ProjectionRevision.Value),
            Binding = CreateBinding(intent.Binding)
        };
        switch (intent.Target)
        {
            case ProjectionTarget.Configuration configuration:
                detail.Configuration = new ConfigurationVersionAuditTarget
                {
                    ConfigurationId =
                        configuration.ConfigurationId.Value,
                    ConfigurationVersionId = configuration.VersionId.Value
                };
                break;
            case ProjectionTarget.Secret secret:
                detail.Secret = new SecretVersionAuditTarget
                {
                    SecretId = secret.SecretId.Value,
                    SecretVersionId = secret.VersionId.Value
                };
                break;
            default:
                throw new InvalidOperationException(
                    "Projection target is invalid");
        }

        return detail;
    }

    private static void AddClaim(
        ConfigurationPublicationAuditDetail detail,
        PublicationAuditIntent intent)
    {
        if (intent.DependencyClaim is null)
        {
            return;
        }

        detail.DependencyClaimId = intent.DependencyClaim.Id.Value;
        detail.DependencyClaimRevision = checked(
            (ulong)intent.DependencyClaim.Revision.Value);
    }

    private static void AddClaim(
        SecretPublicationAuditDetail detail,
        PublicationAuditIntent intent)
    {
        if (intent.DependencyClaim is null)
        {
            return;
        }

        detail.DependencyClaimId = intent.DependencyClaim.Id.Value;
        detail.DependencyClaimRevision = checked(
            (ulong)intent.DependencyClaim.Revision.Value);
    }
}
