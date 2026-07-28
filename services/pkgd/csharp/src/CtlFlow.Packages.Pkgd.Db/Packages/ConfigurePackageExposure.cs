using CtlFlow.Packages.Pkgd.Domain.Packages;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Packages.Pkgd.Db.Packages;

internal static partial class PackageSchema
{
    internal static void ConfigurePackageExposure(ModelBuilder modelBuilder)
    {
        var exposure = modelBuilder.Entity<PackageExposure>();
        exposure.ToTable("package_exposures");
        exposure.Ignore(value => value.PackageId);
        exposure.Ignore(value => value.Generation);
        exposure.Ignore(value => value.ExposureId);
        exposure.Ignore(value => value.InterfaceId);
        exposure.HasKey("_packageId", "_generation", "_exposureId");
        exposure.Property<string>("_packageId")
            .HasColumnName("package_id").HasMaxLength(128).IsRequired();
        exposure.Property<long>("_generation")
            .HasColumnName("generation").IsRequired();
        exposure.Property<string>("_exposureId")
            .HasColumnName("exposure_id").HasMaxLength(64).IsRequired();
        exposure.Property<string>("_interfaceId")
            .HasColumnName("interface_id").HasMaxLength(64).IsRequired();
        exposure.HasIndex("_packageId", "_generation", "_interfaceId")
            .IsUnique();
        exposure.HasOne<PackageInterface>()
            .WithMany()
            .HasForeignKey("_packageId", "_generation", "_interfaceId")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
