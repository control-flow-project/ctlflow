using Microsoft.EntityFrameworkCore;
using Crossfire.AdapterSqlite.Entities;

namespace Crossfire.AdapterSqlite;

public sealed partial class CrossfireDbContext
{
    private static void ConfigureTables6(ModelBuilder model)
    {
        model.Entity<EnrollmentArchiveWakeSenderRow>(entity =>
        {
            entity.ToTable("enrollment_archive_wake_sender");
            entity.HasKey(value => new { value.RequestId, value.InstanceKey, value.SenderPrincipalId });
            entity.Property(value => value.RequestId).HasColumnName("request_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.InstanceKey).HasColumnName("instance_key").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.SenderPrincipalId).HasColumnName("sender_principal_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.IncludeAgents).HasColumnName("include_agents").HasColumnType("INTEGER").ValueGeneratedNever().IsRequired();
        });
        model.Entity<EnrollmentArchiveMetadataRow>(entity =>
        {
            entity.ToTable("enrollment_archive_metadata");
            entity.HasKey(value => new { value.EnrollmentId, value.Key });
            entity.Property(value => value.EnrollmentId).HasColumnName("enrollment_id").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Key).HasColumnName("key").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
            entity.Property(value => value.Value).HasColumnName("value").HasColumnType("TEXT").ValueGeneratedNever().IsRequired();
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
