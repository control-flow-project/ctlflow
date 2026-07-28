using CtlFlow.Configuration.Configd.Domain.Projections;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Configuration.Configd.Db.Projections;

internal static partial class ProjectionSchema
{
    internal static void ConfigureProjectionTargetEntry(
        ModelBuilder modelBuilder)
    {
        var target = modelBuilder.Entity<ProjectionTargetEntry>();
        target.ToTable("projection_targets");
        target.Ignore(value => value.ProjectionId);
        target.Ignore(value => value.EnteredAtRevision);
        target.HasKey("_projectionId", "_targetVersionId");
        target.Property<string>("_projectionId")
            .HasColumnName("projection_id")
            .HasMaxLength(56)
            .IsRequired();
        target.Property<string>("_targetVersionId")
            .HasColumnName("target_version_id")
            .HasMaxLength(64)
            .IsRequired();
        target.Property<long>("_enteredAtRevision")
            .HasColumnName("entered_at_revision")
            .IsRequired();
        target.HasOne<Projection>()
            .WithMany()
            .HasForeignKey("_projectionId")
            .OnDelete(DeleteBehavior.Restrict)
            .IsRequired();
    }
}
