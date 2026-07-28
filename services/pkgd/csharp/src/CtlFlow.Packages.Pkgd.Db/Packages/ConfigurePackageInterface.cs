using CtlFlow.Packages.Pkgd.Domain.Packages;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Packages.Pkgd.Db.Packages;

internal static partial class PackageSchema
{
    internal static void ConfigurePackageInterface(ModelBuilder modelBuilder)
    {
        var provided = modelBuilder.Entity<PackageInterface>();
        provided.ToTable("package_interfaces");
        provided.Ignore(value => value.PackageId);
        provided.Ignore(value => value.Generation);
        provided.Ignore(value => value.InterfaceId);
        provided.Ignore(value => value.ComponentId);
        provided.Ignore(value => value.Protocol);
        provided.Ignore(value => value.ContractId);
        provided.Ignore(value => value.Port);
        provided.HasKey("_packageId", "_generation", "_interfaceId");
        provided.Property<string>("_packageId")
            .HasColumnName("package_id").HasMaxLength(128).IsRequired();
        provided.Property<long>("_generation")
            .HasColumnName("generation").IsRequired();
        provided.Property<string>("_interfaceId")
            .HasColumnName("interface_id").HasMaxLength(64).IsRequired();
        provided.Property<string>("_componentId")
            .HasColumnName("component_id").HasMaxLength(64).IsRequired();
        provided.Property<int>("_protocol")
            .HasColumnName("protocol").IsRequired();
        provided.Property<string>("_contractId")
            .HasColumnName("contract_id").HasMaxLength(128).IsRequired();
        provided.Property<int>("_port")
            .HasColumnName("port").IsRequired();
        provided.HasIndex("_packageId", "_generation", "_componentId");
        provided.HasOne<PackageComponent>()
            .WithMany()
            .HasForeignKey("_packageId", "_generation", "_componentId")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
