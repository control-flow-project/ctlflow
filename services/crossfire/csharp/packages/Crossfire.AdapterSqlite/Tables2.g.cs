using Microsoft.EntityFrameworkCore;
using Crossfire.AdapterSqlite.Entities;

namespace Crossfire.AdapterSqlite;

public sealed partial class CrossfireDbContext
{
    private static void ConfigureTables2(ModelBuilder model)
    {
        model.Entity<AgentWakeSenderRow>(entity =>
        {
            entity.ToTable("agent_wake_sender");
            entity.HasKey(value => new { value.AgentId, value.SenderPrincipalId });
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.SenderPrincipalId).HasColumnName("sender_principal_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.IncludeAgents).HasColumnName("include_agents").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<MemberInvitationRow>(entity =>
        {
            entity.ToTable("member_invitation");
            entity.HasKey(value => value.Id);
            entity.Property(value => value.Id).HasColumnName("id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CreatedByMemberId).HasColumnName("created_by_member_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ClaimHash).HasColumnName("claim_hash").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RoleCode).HasColumnName("role_code").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.PrincipalKind).HasColumnName("principal_kind").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CreatedAt).HasColumnName("created_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ExpiresAt).HasColumnName("expires_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ConsumedByMemberId).HasColumnName("consumed_by_member_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.RevokedAt).HasColumnName("revoked_at").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.ClaimBackendUserId).HasColumnName("claim_backend_user_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.ClaimDisplayName).HasColumnName("claim_display_name").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.ClaimFingerprint).HasColumnName("claim_fingerprint").HasColumnType("TEXT").ValueGeneratedNever();
        });
        model.Entity<MemberSessionRow>(entity =>
        {
            entity.ToTable("member_session");
            entity.HasKey(value => value.SecretHash);
            entity.Property(value => value.SecretHash).HasColumnName("secret_hash").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.MemberId).HasColumnName("member_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CsrfSecret).HasColumnName("csrf_secret").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.NativeAccessToken).HasColumnName("native_access_token").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CreatedAt).HasColumnName("created_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ExpiresAt).HasColumnName("expires_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<ListenerRunRow>(entity =>
        {
            entity.ToTable("listener_run");
            entity.HasKey(value => value.Id);
            entity.Property(value => value.ControllerFleetId).HasColumnName("controller_fleet_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.ControllerConnectionId).HasColumnName("controller_connection_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.ControllerCredentialId).HasColumnName("controller_credential_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.Id).HasColumnName("id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Release).HasColumnName("release").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.StartedAt).HasColumnName("started_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.LastSeenAt).HasColumnName("last_seen_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ActiveMs).HasColumnName("active_ms").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.MessagesDelivered).HasColumnName("messages_delivered").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.StoppedAt).HasColumnName("stopped_at").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.DisconnectRequestedAt).HasColumnName("disconnect_requested_at").HasColumnType("INTEGER").ValueGeneratedNever();
        });
        model.Entity<WakeNoticeRow>(entity =>
        {
            entity.ToTable("wake_notice");
            entity.HasKey(value => new { value.ReceiverAgentId, value.RoomId, value.EventId });
            entity.Property(value => value.ReceiverAgentId).HasColumnName("receiver_agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.EventId).HasColumnName("event_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.SenderBackendUserId).HasColumnName("sender_backend_user_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RoomId).HasColumnName("room_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ReservedAt).HasColumnName("reserved_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.MessageBody).HasColumnName("message_body").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Status).HasColumnName("status").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.SentAt).HasColumnName("sent_at").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.NativeEventId).HasColumnName("native_event_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.NextAttemptAt).HasColumnName("next_attempt_at").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.LastError).HasColumnName("last_error").HasColumnType("TEXT").ValueGeneratedNever();
        });
        model.Entity<InstancePolicyRow>(entity =>
        {
            entity.ToTable("instance_policy");
            entity.HasKey(value => value.Id);
            entity.Property(value => value.Id).HasColumnName("id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Revision).HasColumnName("revision").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.MaxOwnerAgents).HasColumnName("max_owner_agents").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.MaxAgents).HasColumnName("max_agents").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.MaxPending).HasColumnName("max_pending").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.EnrollmentSeconds).HasColumnName("enrollment_seconds").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ReconcileSeconds).HasColumnName("reconcile_seconds").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.MaxMessageBytes).HasColumnName("max_message_bytes").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.FleetIdleTimeoutSeconds).HasColumnName("fleet_idle_timeout_seconds").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AgentInstructions).HasColumnName("agent_instructions").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.SignupMode).HasColumnName("signup_mode").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.InvitationIssuers).HasColumnName("invitation_issuers").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
        });
        model.Entity<AuditEventRow>(entity =>
        {
            entity.ToTable("audit_event");
            entity.HasKey(value => value.Id);
            entity.Property(value => value.Id).HasColumnName("id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RequestId).HasColumnName("request_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ActorCredentialId).HasColumnName("actor_credential_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.ActorKind).HasColumnName("actor_kind").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ActorPrincipalId).HasColumnName("actor_principal_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.OwnerId).HasColumnName("owner_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.TargetKind).HasColumnName("target_kind").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.TargetId).HasColumnName("target_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RoomId).HasColumnName("room_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.MembershipGeneration).HasColumnName("membership_generation").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.AuthorizerId).HasColumnName("authorizer_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.AddedById).HasColumnName("added_by_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.PermissionCode).HasColumnName("permission_code").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.Action).HasColumnName("action").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Outcome).HasColumnName("outcome").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Message).HasColumnName("message").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CreatedAt).HasColumnName("created_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<FleetConnectionRow>(entity =>
        {
            entity.ToTable("fleet_connection");
            entity.HasKey(value => value.FleetId);
            entity.Property(value => value.FleetId).HasColumnName("fleet_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ConnectionId).HasColumnName("connection_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CredentialId).HasColumnName("credential_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.LastSeenAt).HasColumnName("last_seen_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ExpiresAt).HasColumnName("expires_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ClosedAt).HasColumnName("closed_at").HasColumnType("INTEGER").ValueGeneratedNever();
        });
        model.Entity<FleetMessageRow>(entity =>
        {
            entity.ToTable("fleet_message");
            entity.HasKey(value => value.Id);
            entity.Property(value => value.Id).HasColumnName("id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.FleetId).HasColumnName("fleet_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AuthorPrincipalId).HasColumnName("author_principal_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.AuthorCredentialId).HasColumnName("author_credential_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.Body).HasColumnName("body").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CreatedAt).HasColumnName("created_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ExpiresAt).HasColumnName("expires_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<FleetMessageDeliveryRow>(entity =>
        {
            entity.ToTable("fleet_message_delivery");
            entity.HasKey(value => new { value.MessageId, value.AgentId });
            entity.Property(value => value.MessageId).HasColumnName("message_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Status).HasColumnName("status").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CompletedAt).HasColumnName("completed_at").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.ErrorMessage).HasColumnName("error_message").HasColumnType("TEXT").ValueGeneratedNever();
        });
    }
}
