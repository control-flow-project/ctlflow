using CtlFlow.Configuration.Configd.Domain.Projections;
using CtlFlow.Configuration.Configd.Domain.Time;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Configuration.Configd.Db.Bindings.BindingSchema;

namespace CtlFlow.Configuration.Configd.Db.Projections;

internal static partial class ProjectionSchema
{
    internal static void ConfigureProjection(ModelBuilder modelBuilder)
    {
        var projection = modelBuilder.Entity<Projection>();
        projection.ToTable("projections");
        projection.Ignore(value => value.Id);
        projection.Ignore(value => value.Target);
        projection.Ignore(value => value.Binding);
        projection.Ignore(value => value.Revision);
        projection.Ignore(value => value.AuditEventId);
        projection.HasKey("_projectionId");
        projection.Property<string>("_projectionId")
            .HasColumnName("projection_id")
            .HasMaxLength(56)
            .ValueGeneratedNever()
            .IsRequired();
        projection.Property<int>("_dataKind")
            .HasColumnName("data_kind")
            .IsRequired();
        ConfigureBinding(projection);
        projection.Property<string>("_targetIdentityId")
            .HasColumnName("target_identity_id")
            .HasMaxLength(64)
            .IsRequired();
        projection.Property<string>("_currentTargetVersionId")
            .HasColumnName("current_target_version_id")
            .HasMaxLength(64)
            .IsRequired();
        projection.Property<long>("_revision")
            .HasColumnName("revision")
            .IsConcurrencyToken()
            .IsRequired();
        projection.Property<string>("_auditEventId")
            .HasColumnName("audit_event_id")
            .HasMaxLength(36)
            .IsRequired();
        projection.Property(value => value.CreatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("created_at_unix_ms")
            .IsRequired();
        projection.Property(value => value.UpdatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("updated_at_unix_ms")
            .IsRequired();
    }
}
