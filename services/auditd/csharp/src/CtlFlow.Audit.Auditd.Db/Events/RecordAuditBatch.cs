using System.Data;
using CtlFlow.Audit.Auditd.Db.Providers;
using CtlFlow.Audit.Auditd.Domain.Details;
using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Partitions;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Audit.Auditd.Db.Events;

public static partial class AuditEvents
{
    public static async Task<AuditBatchResult> RecordAuditBatch(
        AuditDatabase auditDatabase,
        IReadOnlyList<AuditRecord> records,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = AuditDbTelemetry.StartOperation(
            "record_audit_batch");
        await using var mutation =
            await auditDatabase.AcquireMutation(cancellation);
        await using var database =
            await auditDatabase.Contexts.CreateDbContextAsync(cancellation);
        await using var transaction = await database.Database
            .BeginTransactionAsync(IsolationLevel.Serializable, cancellation);

        var acceptances =
            new Dictionary<string, AuditAcceptance>(StringComparer.Ordinal);
        var novel = new List<AuditRecord>(records.Count);
        foreach (var record in records)
        {
            var sourcePrincipal = record.SourcePrincipal;
            var sourceEventId = record.SourceEventId;
            var queryCancellation = cancellation;
            var stored = await database.AuditEvents
                .AsNoTracking()
                .Where(value =>
                    EF.Property<string>(value, "SourcePrincipal")
                        == sourcePrincipal
                    && EF.Property<string>(value, "SourceEventId")
                        == sourceEventId)
                .Select(value => new
                {
                    ContentHash = EF.Property<string>(
                        value,
                        "ContentHash"),
                    PartitionCursor = EF.Property<long>(
                        value,
                        "PartitionCursor")
                })
                .SingleOrDefaultAsync(queryCancellation);
            if (stored is null)
            {
                novel.Add(record);
                continue;
            }

            if (!string.Equals(
                    stored.ContentHash,
                    record.ContentHash,
                    StringComparison.Ordinal))
            {
                throw new AuditContentConflictException();
            }

            acceptances.Add(
                record.EventKey,
                new AuditAcceptance(
                    AuditEventId.FromStorage(record.SourceEventId),
                    PartitionCursor.FromStorage(
                        stored.PartitionCursor)));
        }

        var heads = new Dictionary<string, AuditPartitionHead>(
            StringComparer.Ordinal);
        var now = DateTimeOffset.UtcNow;
        var acceptedAtSeconds = now.ToUnixTimeSeconds();
        var acceptedAtNanoseconds =
            (int)(now.Ticks % TimeSpan.TicksPerSecond * 100);
        foreach (var record in novel)
        {
            if (!heads.TryGetValue(record.PartitionKey, out var head))
            {
                var partitionKey = record.PartitionKey;
                var queryCancellation = cancellation;
                var stored = await database.PartitionHeads
                    .AsNoTracking()
                    .Where(value =>
                        EF.Property<string>(value, "PartitionKey")
                            == partitionKey)
                    .Select(value => new
                    {
                        PartitionKey = EF.Property<string>(
                            value,
                            "PartitionKey"),
                        PartitionKind = EF.Property<int>(
                            value,
                            "PartitionKind"),
                        TenantId = EF.Property<string?>(
                            value,
                            "TenantId"),
                        CurrentCursor = EF.Property<long>(
                            value,
                            "CurrentCursor")
                    })
                    .SingleOrDefaultAsync(queryCancellation);
                head = stored is null
                    ? new AuditPartitionHead(
                        record.PartitionKey,
                        (int)record.PartitionKind,
                        record.PartitionTenantId,
                        0)
                    : new AuditPartitionHead(
                        stored.PartitionKey,
                        stored.PartitionKind,
                        stored.TenantId,
                        stored.CurrentCursor);
                if (stored is null)
                {
                    database.PartitionHeads.Add(head);
                }
                else
                {
                    database.PartitionHeads.Attach(head);
                }

                heads.Add(partitionKey, head);
            }

            var cursor = head.Advance();
            record.Accept(
                cursor,
                acceptedAtSeconds,
                acceptedAtNanoseconds);
            database.AuditEvents.Add(record);
            AddDetail(database, record.Detail);
            acceptances.Add(
                record.EventKey,
                new AuditAcceptance(
                    AuditEventId.FromStorage(record.SourceEventId),
                    PartitionCursor.FromAcceptance(cursor)));
        }

        cancellation.ThrowIfCancellationRequested();
        await database.SaveChangesAsync(cancellation);
        cancellation.ThrowIfCancellationRequested();
        await transaction.CommitAsync(cancellation);

        return new AuditBatchResult(
            records.Select(value => acceptances[value.EventKey]).ToArray(),
            novel.Count,
            records.Count - novel.Count);
    }

    private static void AddDetail(
        AuditDbContext database,
        AuditDetail detail)
    {
        switch (detail)
        {
            case TenantMutationAuditDetail value:
                database.TenantMutationDetails.Add(value);
                break;
            case WorkspaceMutationAuditDetail value:
                database.WorkspaceMutationDetails.Add(value);
                break;
            case IdentitySessionAuditDetail value:
                database.IdentitySessionDetails.Add(value);
                break;
            case IdentityMembershipAuditDetail value:
                database.IdentityMembershipDetails.Add(value);
                break;
            case IdentityGroupAuditDetail value:
                database.IdentityGroupDetails.Add(value);
                break;
            case IdentityGroupMemberAuditDetail value:
                database.IdentityGroupMemberDetails.Add(value);
                break;
            case IdentityVirtualPrincipalAuditDetail value:
                database.IdentityVirtualPrincipalDetails.Add(value);
                break;
            case IdentityExternalLinkAuditDetail value:
                database.IdentityExternalLinkDetails.Add(value);
                break;
            case IdentityLoginProviderAuditDetail value:
                database.IdentityLoginProviderDetails.Add(value);
                break;
            case IdentityWorkspaceProviderAdmissionAuditDetail value:
                database.IdentityWorkspaceProviderAdmissionDetails.Add(
                    value);
                break;
            case PackageDeclarationAuditDetail value:
                database.PackageDeclarationDetails.Add(value);
                break;
            case AppMutationAuditDetail value:
                database.AppMutationDetails.Add(value);
                break;
            case ConfigurationPublicationAuditDetail value:
                database.ConfigurationPublicationDetails.Add(value);
                break;
            case SecretPublicationAuditDetail value:
                database.SecretPublicationDetails.Add(value);
                break;
            case ProjectionMutationAuditDetail value:
                database.ProjectionMutationDetails.Add(value);
                break;
            case PlacementMutationAuditDetail value:
                database.PlacementMutationDetails.Add(value);
                break;
            case WorkloadMutationAuditDetail value:
                database.WorkloadMutationDetails.Add(value);
                break;
            case RunMutationAuditDetail value:
                database.RunMutationDetails.Add(value);
                break;
            default:
                throw new InvalidOperationException(
                    "Audit detail is not mapped");
        }
    }
}
