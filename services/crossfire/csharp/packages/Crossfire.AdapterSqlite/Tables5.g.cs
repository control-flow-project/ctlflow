using Microsoft.EntityFrameworkCore;
using Crossfire.AdapterSqlite.Entities;

namespace Crossfire.AdapterSqlite;

public sealed partial class CrossfireDbContext
{
    private static void ConfigureTables5(ModelBuilder model)
    {
        model.Entity<EnrollmentItemWakeSenderRow>(entity =>
        {
            entity.ToTable("enrollment_item_wake_sender");
            entity.HasKey(value => new { value.RequestId, value.InstanceKey, value.SenderPrincipalId });
            entity.Property(value => value.RequestId).HasColumnName("request_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.InstanceKey).HasColumnName("instance_key").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.SenderPrincipalId).HasColumnName("sender_principal_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.IncludeAgents).HasColumnName("include_agents").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<FleetInstancePolicyRow>(entity =>
        {
            entity.ToTable("fleet_instance_policy");
            entity.HasKey(value => value.AgentId);
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ApprovedByMemberId).HasColumnName("approved_by_member_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ApprovedAt).HasColumnName("approved_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<FleetInstancePermissionRow>(entity =>
        {
            entity.ToTable("fleet_instance_permission");
            entity.HasKey(value => new { value.AgentId, value.PermissionCode });
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.PermissionCode).HasColumnName("permission_code").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.GrantScope).HasColumnName("grant_scope").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
        });
        model.Entity<FleetRuntimeOperationRow>(entity =>
        {
            entity.ToTable("fleet_runtime_operation");
            entity.HasKey(value => value.Id);
            entity.Property(value => value.Id).HasColumnName("id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.FleetId).HasColumnName("fleet_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.AuthorPrincipalId).HasColumnName("author_principal_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Action).HasColumnName("action").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ExpectedRevision).HasColumnName("expected_revision").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Status).HasColumnName("status").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CreatedAt).HasColumnName("created_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CompletedAt).HasColumnName("completed_at").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.ErrorMessage).HasColumnName("error_message").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.ConnectionId).HasColumnName("connection_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.CredentialId).HasColumnName("credential_id").HasColumnType("TEXT").ValueGeneratedNever();
        });
        model.Entity<PublicationRow>(entity =>
        {
            entity.ToTable("publication");
            entity.HasKey(value => value.Id);
            entity.Property(value => value.Id).HasColumnName("id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.PublicKey).HasColumnName("public_key").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Title).HasColumnName("title").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.State).HasColumnName("state").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Revision).HasColumnName("revision").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CreatedAt).HasColumnName("created_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ExpiresAt).HasColumnName("expires_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.PublishedAt).HasColumnName("published_at").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.DeletedAt).HasColumnName("deleted_at").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.CleanedAt).HasColumnName("cleaned_at").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.TotalBytes).HasColumnName("total_bytes").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.FileCount).HasColumnName("file_count").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<PublicationFileRow>(entity =>
        {
            entity.ToTable("publication_file");
            entity.HasKey(value => value.Id);
            entity.Property(value => value.Id).HasColumnName("id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.PublicationId).HasColumnName("publication_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Path).HasColumnName("path").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.MediaType).HasColumnName("media_type").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Bytes).HasColumnName("bytes").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Sha256).HasColumnName("sha256").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Uploaded).HasColumnName("uploaded").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<FleetNativeStopRow>(entity =>
        {
            entity.ToTable("fleet_native_stop");
            entity.HasKey(value => new { value.AgentId, value.ReceiptId });
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ReceiptId).HasColumnName("receipt_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Sequence).HasColumnName("sequence").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.FleetId).HasColumnName("fleet_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RunId).HasColumnName("run_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ConnectionId).HasColumnName("connection_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CredentialId).HasColumnName("credential_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.NativeStoppedAt).HasColumnName("native_stopped_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.InvalidatedAt).HasColumnName("invalidated_at").HasColumnType("INTEGER").ValueGeneratedNever();
        });
    }
}
