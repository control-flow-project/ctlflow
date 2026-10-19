using Microsoft.EntityFrameworkCore;
using Crossfire.AdapterSqlite.Entities;

namespace Crossfire.AdapterSqlite;

public sealed partial class CrossfireDbContext
{
    private static void ConfigureTables4(ModelBuilder model)
    {
        model.Entity<RuntimeIncidentRow>(entity =>
        {
            entity.ToTable("runtime_incident");
            entity.HasKey(value => value.Id);
            entity.Property(value => value.Id).HasColumnName("id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.OwnerId).HasColumnName("owner_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.FleetId).HasColumnName("fleet_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.RunId).HasColumnName("run_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.SessionId).HasColumnName("session_id").HasColumnType("TEXT").ValueGeneratedNever();
            entity.Property(value => value.Kind).HasColumnName("kind").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Message).HasColumnName("message").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CreatedAt).HasColumnName("created_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RecoveredAt).HasColumnName("recovered_at").HasColumnType("INTEGER").ValueGeneratedNever();
        });
        model.Entity<IncidentNotificationRow>(entity =>
        {
            entity.ToTable("incident_notification");
            entity.HasKey(value => new { value.IncidentId, value.Phase });
            entity.Property(value => value.IncidentId).HasColumnName("incident_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Phase).HasColumnName("phase").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Body).HasColumnName("body").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.NextAttemptAt).HasColumnName("next_attempt_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.EventId).HasColumnName("event_id").HasColumnType("TEXT").ValueGeneratedNever();
        });
        model.Entity<ManagementConversationRow>(entity =>
        {
            entity.ToTable("management_conversation");
            entity.HasKey(value => value.OwnerId);
            entity.Property(value => value.OwnerId).HasColumnName("owner_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RoomId).HasColumnName("room_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CreatedAt).HasColumnName("created_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<ListenerStatCheckpointRow>(entity =>
        {
            entity.ToTable("listener_stat_checkpoint");
            entity.HasKey(value => value.RunId);
            entity.Property(value => value.RunId).HasColumnName("run_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Sequence).HasColumnName("sequence").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Digest).HasColumnName("digest").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CapturedAt).HasColumnName("captured_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<ListenerStatIntervalRow>(entity =>
        {
            entity.ToTable("listener_stat_interval");
            entity.HasKey(value => new { value.RunId, value.BucketAt });
            entity.Property(value => value.RunId).HasColumnName("run_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.BucketAt).HasColumnName("bucket_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.StartedAt).HasColumnName("started_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.EndedAt).HasColumnName("ended_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CapturedAt).HasColumnName("captured_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Dropped).HasColumnName("dropped").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<ListenerStatFlowRow>(entity =>
        {
            entity.ToTable("listener_stat_flow");
            entity.HasKey(value => new { value.RunId, value.BucketAt, value.RoomId, value.SenderBackendUserId, value.MessageType });
            entity.Property(value => value.RunId).HasColumnName("run_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.BucketAt).HasColumnName("bucket_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.RoomId).HasColumnName("room_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.SenderBackendUserId).HasColumnName("sender_backend_user_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.MessageType).HasColumnName("message_type").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Observed).HasColumnName("observed").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Delivered).HasColumnName("delivered").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ContentBytes).HasColumnName("content_bytes").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.DeliveredBytes).HasColumnName("delivered_bytes").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.AttachmentBytes).HasColumnName("attachment_bytes").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.LargestBytes).HasColumnName("largest_bytes").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<ListenerStatUsageRow>(entity =>
        {
            entity.ToTable("listener_stat_usage");
            entity.HasKey(value => new { value.RunId, value.BucketAt, value.Runtime, value.SessionId });
            entity.Property(value => value.RunId).HasColumnName("run_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.BucketAt).HasColumnName("bucket_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Runtime).HasColumnName("runtime").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.SessionId).HasColumnName("session_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Input).HasColumnName("input").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CachedInput).HasColumnName("cached_input").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CacheWriteInput).HasColumnName("cache_write_input").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.Output).HasColumnName("output").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ReasoningOutput).HasColumnName("reasoning_output").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.Total).HasColumnName("total").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<RuntimeUsageCheckpointRow>(entity =>
        {
            entity.ToTable("runtime_usage_checkpoint");
            entity.HasKey(value => new { value.AgentId, value.Runtime, value.SessionId });
            entity.Property(value => value.AgentId).HasColumnName("agent_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Runtime).HasColumnName("runtime").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.SessionId).HasColumnName("session_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Input).HasColumnName("input").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CachedInput).HasColumnName("cached_input").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CacheWriteInput).HasColumnName("cache_write_input").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.Output).HasColumnName("output").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ReasoningOutput).HasColumnName("reasoning_output").HasColumnType("INTEGER").ValueGeneratedNever();
            entity.Property(value => value.Total).HasColumnName("total").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.CapturedAt).HasColumnName("captured_at").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<EnrollmentItemPolicyRow>(entity =>
        {
            entity.ToTable("enrollment_item_policy");
            entity.HasKey(value => new { value.RequestId, value.InstanceKey });
            entity.Property(value => value.RequestId).HasColumnName("request_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.InstanceKey).HasColumnName("instance_key").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.WakeMode).HasColumnName("wake_mode").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.ExpectedAgentRevision).HasColumnName("expected_agent_revision").HasColumnType("INTEGER").ValueGeneratedNever();
        });
        model.Entity<EnrollmentItemPermissionRow>(entity =>
        {
            entity.ToTable("enrollment_item_permission");
            entity.HasKey(value => new { value.RequestId, value.InstanceKey, value.PermissionCode });
            entity.Property(value => value.RequestId).HasColumnName("request_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.InstanceKey).HasColumnName("instance_key").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.PermissionCode).HasColumnName("permission_code").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.GrantScope).HasColumnName("grant_scope").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
        });
    }
}
