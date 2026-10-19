using Microsoft.EntityFrameworkCore;
using Crossfire.AdapterSqlite.Entities;

namespace Crossfire.AdapterSqlite;

public sealed partial class CrossfireDbContext
{
    private static void ConfigureTables0(ModelBuilder model)
    {
        model.Entity<PrincipalRow>(entity =>
        {
            entity.ToTable("principal");
            entity.HasKey(value => value.Id);
            entity.Property(value => value.Id).HasColumnName("id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.BackendUserId).HasColumnName("backend_user_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Kind).HasColumnName("kind").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Status).HasColumnName("status").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Revision).HasColumnName("revision").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CreatedAt).HasColumnName("created_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<MemberRow>(entity =>
        {
            entity.ToTable("member");
            entity.HasKey(value => value.PrincipalId);
            entity.Property(value => value.PrincipalId).HasColumnName("principal_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.PrincipalKind).HasColumnName("principal_kind").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.DisplayName).HasColumnName("display_name").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
        });
        model.Entity<AgentRow>(entity =>
        {
            entity.ToTable("agent");
            entity.HasKey(value => value.PrincipalId);
            entity.Property(value => value.PrincipalId).HasColumnName("principal_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.PrincipalKind).HasColumnName("principal_kind").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.OwnerId).HasColumnName("owner_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.WakeMode).HasColumnName("wake_mode").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
        });
        model.Entity<AgentCredentialRow>(entity =>
        {
            entity.ToTable("agent_credential");
            entity.HasKey(value => value.AgentId);
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ProvisioningPassword).HasColumnName("provisioning_password").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AccessToken).HasColumnName("access_token").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.UpdatedAt).HasColumnName("updated_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<PrincipalApplicationRow>(entity =>
        {
            entity.ToTable("principal_application");
            entity.HasKey(value => value.PrincipalId);
            entity.Property(value => value.PrincipalId).HasColumnName("principal_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AppliedRevision).HasColumnName("applied_revision").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.AppliedIntentHash).HasColumnName("applied_intent_hash").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.AppliedStatus).HasColumnName("applied_status").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.NativeDisplayName).HasColumnName("native_display_name").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.LastAttemptAt).HasColumnName("last_attempt_at").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.LastSuccessAt).HasColumnName("last_success_at").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.NextCheckAt).HasColumnName("next_check_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ErrorCode).HasColumnName("error_code").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.ErrorMessage).HasColumnName("error_message").HasColumnType("TEXT").ValueGeneratedNever();
        });
        model.Entity<PermissionRow>(entity =>
        {
            entity.ToTable("permission");
            entity.HasKey(value => value.Code);
            entity.Property(value => value.Code).HasColumnName("code").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.GrantScope).HasColumnName("grant_scope").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Description).HasColumnName("description").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
        });
        model.Entity<RoleRow>(entity =>
        {
            entity.ToTable("role");
            entity.HasKey(value => value.Code);
            entity.Property(value => value.Code).HasColumnName("code").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.PrincipalKind).HasColumnName("principal_kind").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Label).HasColumnName("label").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
        });
        model.Entity<RolePermissionRow>(entity =>
        {
            entity.ToTable("role_permission");
            entity.HasKey(value => new { value.RoleCode, value.PermissionCode });
            entity.Property(value => value.RoleCode).HasColumnName("role_code").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.PermissionCode).HasColumnName("permission_code").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.GrantScope).HasColumnName("grant_scope").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
        });
        model.Entity<PrincipalRoleRow>(entity =>
        {
            entity.ToTable("principal_role");
            entity.HasKey(value => value.PrincipalId);
            entity.Property(value => value.PrincipalId).HasColumnName("principal_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.PrincipalKind).HasColumnName("principal_kind").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RoleCode).HasColumnName("role_code").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AssignedByMemberId).HasColumnName("assigned_by_member_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.AssignedAt).HasColumnName("assigned_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<EnrollmentRequestRow>(entity =>
        {
            entity.ToTable("enrollment_request");
            entity.HasKey(value => value.Id);
            entity.Property(value => value.ControllerName).HasColumnName("controller_name").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ControllerCredentialHash).HasColumnName("controller_credential_hash").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Id).HasColumnName("id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.OwnerId).HasColumnName("owner_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.FleetKey).HasColumnName("fleet_key").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
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
    }
}
