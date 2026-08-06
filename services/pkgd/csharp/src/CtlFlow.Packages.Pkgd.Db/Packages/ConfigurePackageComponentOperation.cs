using CtlFlow.Packages.Pkgd.Domain.Packages;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Packages.Pkgd.Db.Packages;

internal static partial class PackageSchema
{
    internal static void ConfigurePackageComponentOperation(
        ModelBuilder modelBuilder)
    {
        var operation = modelBuilder.Entity<PackageComponentOperation>();
        operation.ToTable("package_component_operations");
        operation.Ignore(value => value.PackageId);
        operation.Ignore(value => value.Generation);
        operation.Ignore(value => value.ComponentId);
        operation.Ignore(value => value.Operation);
        // The operation is unique across the generation, so exactly one
        // component owns it there.
        operation.HasKey("_packageId", "_generation", "_operation");
        operation.Property<string>("_packageId")
            .HasColumnName("package_id").HasMaxLength(128).IsRequired();
        operation.Property<long>("_generation")
            .HasColumnName("generation").IsRequired();
        operation.Property<string>("_componentId")
            .HasColumnName("component_id").HasMaxLength(64).IsRequired();
        operation.Property<string>("_operation")
            .HasColumnName("operation").HasMaxLength(128).IsRequired();
        operation.HasIndex("_packageId", "_generation", "_componentId")
            .HasDatabaseName("package_component_operations_component_idx");
        operation.HasOne<PackageComponent>()
            .WithMany()
            .HasForeignKey("_packageId", "_generation", "_componentId")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
