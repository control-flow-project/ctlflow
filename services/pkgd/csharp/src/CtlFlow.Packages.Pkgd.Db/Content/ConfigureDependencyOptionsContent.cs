using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Packages.Pkgd.Db.Content;

internal static partial class DependencyOptionsContentSchema
{
    internal static void ConfigureDependencyOptionsContent(
        ModelBuilder modelBuilder)
    {
        var options = modelBuilder.Entity<DependencyOptionsContentRow>();
        options.ToTable("package_dependency_options");
        options.HasKey(
            value => new
            {
                value.PackageId,
                value.Generation,
                value.ComponentId,
                value.DependencyName
            });
        options.Property(value => value.PackageId)
            .HasColumnName("package_id")
            .HasMaxLength(128)
            .IsRequired();
        options.Property(value => value.Generation)
            .HasColumnName("generation")
            .IsRequired();
        options.Property(value => value.ComponentId)
            .HasColumnName("component_id")
            .HasMaxLength(64)
            .IsRequired();
        options.Property(value => value.DependencyName)
            .HasColumnName("dependency_name")
            .HasMaxLength(400)
            .IsRequired();
        options.Property(value => value.Format)
            .HasColumnName("format")
            .IsRequired();
        options.Property(value => value.ByteLength)
            .HasColumnName("byte_length")
            .IsRequired();
        options.Property(value => value.Digest)
            .HasColumnName("digest")
            .HasMaxLength(71)
            .IsRequired();
        options.Property(value => value.CanonicalJson)
            .HasColumnName("canonical_json")
            .HasMaxLength(65_536)
            .IsRequired();

        options.HasOne<Domain.Packages.PackageDependency>()
            .WithOne()
            .HasForeignKey<DependencyOptionsContentRow>(
                value => new
                {
                    value.PackageId,
                    value.Generation,
                    value.ComponentId,
                    value.DependencyName
                })
            .OnDelete(DeleteBehavior.Restrict);
    }
}
