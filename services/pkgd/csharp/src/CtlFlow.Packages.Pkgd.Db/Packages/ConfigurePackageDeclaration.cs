using CtlFlow.Packages.Pkgd.Domain.Packages;
using CtlFlow.Packages.Pkgd.Domain.Time;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Packages.Pkgd.Db.Packages;

internal static partial class PackageSchema
{
    internal static void ConfigurePackageDeclaration(ModelBuilder modelBuilder)
    {
        var package = modelBuilder.Entity<PackageDeclaration>();
        package.ToTable("package_generations");
        package.Ignore(value => value.PackageId);
        package.Ignore(value => value.Generation);
        package.Ignore(value => value.Version);
        package.Ignore(value => value.Provenance);
        package.HasKey("_packageId", "_generation");
        package.Property<string>("_packageId")
            .HasColumnName("package_id")
            .HasMaxLength(128)
            .IsRequired();
        package.Property<long>("_generation")
            .HasColumnName("generation")
            .IsRequired();
        package.Property<string>("_version")
            .HasColumnName("version")
            .HasMaxLength(128)
            .IsRequired();
        package.Property<string>("_sourceUri")
            .HasColumnName("source_uri")
            .HasMaxLength(2_048)
            .IsRequired();
        package.Property<string>("_sourceDigest")
            .HasColumnName("source_digest")
            .HasMaxLength(71)
            .IsRequired();
        package.Property(value => value.DeclaredAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("declared_at_unix_ms")
            .IsRequired();
        package.HasIndex("_packageId", "_version").IsUnique();
    }
}
