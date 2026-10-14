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
        model.Entity<EnrollmentArchiveRow>(entity =>
        {
            entity.ToTable("enrollment_archive");
            entity.HasKey(value => value.Id);
            entity.Property(value => value.ControllerName).HasColumnName("controller_name").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.ControllerCredentialHash).HasColumnName("controller_credential_hash").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.FleetKey).HasColumnName("fleet_key").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.Id).HasColumnName("id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.OwnerId).HasColumnName("owner_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.VerificationCode).HasColumnName("verification_code").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ClaimHash).HasColumnName("claim_hash").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RosterDigest).HasColumnName("roster_digest").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Status).HasColumnName("status").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Revision).HasColumnName("revision").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CreatedAt).HasColumnName("created_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ExpiresAt).HasColumnName("expires_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.DecidedByMemberId).HasColumnName("decided_by_member_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.DecidedAt).HasColumnName("decided_at").HasColumnType("INTEGER").ValueGeneratedNever();
        });
        model.Entity<EnrollmentArchiveItemRow>(entity =>
        {
            entity.ToTable("enrollment_archive_item");
            entity.HasKey(value => new { value.RequestId, value.InstanceKey });
            entity.Property(value => value.RequestId).HasColumnName("request_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.InstanceKey).HasColumnName("instance_key").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RequestedName).HasColumnName("requested_name").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Outcome).HasColumnName("outcome").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.FailureCode).HasColumnName("failure_code").HasColumnType("TEXT").ValueGeneratedNever();
        });
        model.Entity<EnrollmentArchivePolicyRow>(entity =>
        {
            entity.ToTable("enrollment_archive_policy");
            entity.HasKey(value => new { value.RequestId, value.InstanceKey });
            entity.Property(value => value.RequestId).HasColumnName("request_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.InstanceKey).HasColumnName("instance_key").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.WakeMode).HasColumnName("wake_mode").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ExpectedAgentRevision).HasColumnName("expected_agent_revision").HasColumnType("INTEGER").ValueGeneratedNever();
        });
        model.Entity<EnrollmentArchivePermissionRow>(entity =>
        {
            entity.ToTable("enrollment_archive_permission");
            entity.HasKey(value => new { value.RequestId, value.InstanceKey, value.PermissionCode });
            entity.Property(value => value.RequestId).HasColumnName("request_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.InstanceKey).HasColumnName("instance_key").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.PermissionCode).HasColumnName("permission_code").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.GrantScope).HasColumnName("grant_scope").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
        });
    }
}
