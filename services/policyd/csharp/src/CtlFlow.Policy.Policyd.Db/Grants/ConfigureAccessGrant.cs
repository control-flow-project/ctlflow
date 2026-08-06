using CtlFlow.Policy.Policyd.Domain.Grants;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Policy.Policyd.Db.Grants;

internal static partial class AccessGrantSchema
{
    internal static void ConfigureAccessGrant(ModelBuilder modelBuilder)
    {
        var grant = modelBuilder.Entity<AccessGrant>();
        grant.ToTable("access_grants");
        grant.Ignore(value => value.Id);
        grant.Ignore(value => value.TargetKind);
        grant.Ignore(value => value.TenantId);
        grant.Ignore(value => value.WorkspaceId);
        grant.Ignore(value => value.SubjectKind);
        grant.Ignore(value => value.SubjectId);
        grant.Ignore(value => value.Operation);
        grant.Ignore(value => value.OperationOwnerKind);
        grant.Ignore(value => value.OperationOwnerId);
        grant.Ignore(value => value.BasePath);
        grant.Ignore(value => value.MatchKind);
        grant.HasKey("_id");
        grant.Property<long>("_id")
            .HasColumnName("access_grant_id")
            .ValueGeneratedOnAdd();
        grant.Property<int>("_targetKind")
            .HasColumnName("target_kind")
            .IsRequired();
        grant.Property<string>("_tenantId")
            .HasColumnName("tenant_id")
            .HasMaxLength(64)
            .IsRequired();
        grant.Property<string?>("_workspaceId")
            .HasColumnName("workspace_id")
            .HasMaxLength(64);
        grant.Property<int>("_subjectKind")
            .HasColumnName("subject_kind")
            .IsRequired();
        grant.Property<string>("_subjectId")
            .HasColumnName("subject_id")
            .HasMaxLength(256)
            .IsRequired();
        grant.Property<int>("_operationOwnerKind")
            .HasColumnName("operation_owner_kind")
            .IsRequired();
        grant.Property<string>("_operationOwnerId")
            .HasColumnName("operation_owner_id")
            .HasMaxLength(128)
            .IsRequired();
        grant.Property<string>("_operation")
            .HasColumnName("operation")
            .HasMaxLength(128)
            .IsRequired();
        grant.Property<string>("_basePath")
            .HasColumnName("base_path")
            .HasMaxLength(512)
            .IsRequired();
        grant.Property<int>("_matchKind")
            .HasColumnName("match_kind")
            .IsRequired();
        grant.HasIndex(
                "_targetKind",
                "_tenantId",
                "_workspaceId",
                "_operationOwnerKind",
                "_operationOwnerId",
                "_operation",
                "_subjectKind",
                "_subjectId")
            .HasDatabaseName("access_grants_decision_idx");
        grant.HasIndex(
                "_tenantId",
                "_subjectKind",
                "_subjectId",
                "_operationOwnerKind",
                "_operationOwnerId",
                "_operation",
                "_basePath",
                "_matchKind")
            .IsUnique()
            .HasFilter("target_kind = 1")
            .HasDatabaseName("access_grants_tenant_unique_idx");
        grant.HasIndex(
                "_tenantId",
                "_workspaceId",
                "_subjectKind",
                "_subjectId",
                "_operationOwnerKind",
                "_operationOwnerId",
                "_operation",
                "_basePath",
                "_matchKind")
            .IsUnique()
            .HasFilter("target_kind = 2")
            .HasDatabaseName("access_grants_workspace_unique_idx");
    }
}
