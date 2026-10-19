using Microsoft.EntityFrameworkCore;
using Crossfire.AdapterSqlite.Entities;

namespace Crossfire.AdapterSqlite;

public sealed partial class CrossfireDbContext
{
    private static void ConfigureTables1(ModelBuilder model)
    {
        model.Entity<EnrollmentItemRow>(entity =>
        {
            entity.ToTable("enrollment_item");
            entity.HasKey(value => new { value.RequestId, value.InstanceKey });
            entity.Property(value => value.RequestId).HasColumnName("request_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.InstanceKey).HasColumnName("instance_key").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RequestedName).HasColumnName("requested_name").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Outcome).HasColumnName("outcome").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever();
        });
        model.Entity<AgentNameRow>(entity =>
        {
            entity.ToTable("agent_name");
            entity.HasKey(value => value.Name);
            entity.Property(value => value.Name).HasColumnName("name").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RequestId).HasColumnName("request_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.InstanceKey).HasColumnName("instance_key").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever();
        });
        model.Entity<FleetRow>(entity =>
        {
            entity.ToTable("fleet");
            entity.HasKey(value => new { value.OwnerId, value.FleetKey });
            entity.Property(value => value.ArchivedAt).HasColumnName("archived_at").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.Id).HasColumnName("id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.DeliveryEnabled).HasColumnName("delivery_enabled").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Label).HasColumnName("label").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ControllerName).HasColumnName("controller_name").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Revision).HasColumnName("revision").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.UpdatedAt).HasColumnName("updated_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.OwnerId).HasColumnName("owner_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.FleetKey).HasColumnName("fleet_key").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CreatedAt).HasColumnName("created_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<FleetInstanceRow>(entity =>
        {
            entity.ToTable("fleet_instance");
            entity.HasKey(value => new { value.OwnerId, value.FleetKey, value.InstanceKey });
            entity.Property(value => value.RetiredAt).HasColumnName("retired_at").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.OwnerId).HasColumnName("owner_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.FleetKey).HasColumnName("fleet_key").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.InstanceKey).HasColumnName("instance_key").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
        });
        model.Entity<FleetCredentialRow>(entity =>
        {
            entity.ToTable("fleet_credential");
            entity.HasKey(value => value.Id);
            entity.Property(value => value.Id).HasColumnName("id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.FleetId).HasColumnName("fleet_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.SecretHash).HasColumnName("secret_hash").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CreatedAt).HasColumnName("created_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RevokedAt).HasColumnName("revoked_at").HasColumnType("INTEGER").ValueGeneratedNever();
        });
        model.Entity<FleetControllerMetadataRow>(entity =>
        {
            entity.ToTable("fleet_controller_metadata");
            entity.HasKey(value => new { value.FleetId, value.Key });
            entity.Property(value => value.FleetId).HasColumnName("fleet_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Key).HasColumnName("key").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Value).HasColumnName("value").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
        });
        model.Entity<EnrollmentControllerMetadataRow>(entity =>
        {
            entity.ToTable("enrollment_controller_metadata");
            entity.HasKey(value => new { value.EnrollmentId, value.Key });
            entity.Property(value => value.EnrollmentId).HasColumnName("enrollment_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Key).HasColumnName("key").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Value).HasColumnName("value").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
        });
        model.Entity<AgentRoomGrantRow>(entity =>
        {
            entity.ToTable("agent_room_grant");
            entity.HasKey(value => new { value.AgentId, value.RoomId });
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RoomId).HasColumnName("room_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Generation).HasColumnName("generation").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AuthorizerId).HasColumnName("authorizer_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AddedById).HasColumnName("added_by_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.InvitationEventId).HasColumnName("invitation_event_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.AdmissionKind).HasColumnName("admission_kind").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AccessMode).HasColumnName("access_mode").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.NativeAccess).HasColumnName("native_access").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.Muted).HasColumnName("muted").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Revision).HasColumnName("revision").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AccessRevision).HasColumnName("access_revision").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.UpdatedAt).HasColumnName("updated_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<AgentRoomPermissionRow>(entity =>
        {
            entity.ToTable("agent_room_permission");
            entity.HasKey(value => new { value.AgentId, value.RoomId, value.PermissionCode });
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RoomId).HasColumnName("room_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Generation).HasColumnName("generation").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.PermissionCode).HasColumnName("permission_code").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.GrantScope).HasColumnName("grant_scope").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.GrantedByMemberId).HasColumnName("granted_by_member_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.GrantedAt).HasColumnName("granted_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<RoomGrantApplicationRow>(entity =>
        {
            entity.ToTable("room_grant_application");
            entity.HasKey(value => new { value.AgentId, value.RoomId });
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RoomId).HasColumnName("room_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ObservedGeneration).HasColumnName("observed_generation").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.AppliedRevision).HasColumnName("applied_revision").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.AppliedAccessRevision).HasColumnName("applied_access_revision").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.Membership).HasColumnName("membership").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.NativeAccess).HasColumnName("native_access").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.LastAttemptAt).HasColumnName("last_attempt_at").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.LastSuccessAt).HasColumnName("last_success_at").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.NextCheckAt).HasColumnName("next_check_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ErrorCode).HasColumnName("error_code").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.ErrorMessage).HasColumnName("error_message").HasColumnType("TEXT").ValueGeneratedNever();
        });
    }
}
