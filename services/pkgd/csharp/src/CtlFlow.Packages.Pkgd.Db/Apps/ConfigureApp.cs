using CtlFlow.Packages.Pkgd.Domain.Apps;
using CtlFlow.Packages.Pkgd.Domain.Packages;
using CtlFlow.Packages.Pkgd.Domain.Time;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Packages.Pkgd.Db.Apps;

internal static partial class AppSchema
{
    internal static void ConfigureApp(ModelBuilder modelBuilder)
    {
        var app = modelBuilder.Entity<App>();
        app.ToTable("apps");
        app.Ignore(value => value.AppId);
        app.Ignore(value => value.Scope);
        app.Ignore(value => value.PlacementId);
        app.Ignore(value => value.PackageId);
        app.Ignore(value => value.InitialPackageGeneration);
        app.Ignore(value => value.DesiredPackageGeneration);
        app.Ignore(value => value.Revision);
        app.HasKey("_appId");
        app.Property<string>("_appId")
            .HasColumnName("app_id").HasMaxLength(64).IsRequired();
        app.Property<int>("_scopeKind")
            .HasColumnName("scope_kind").IsRequired();
        app.Property<string?>("_tenantId")
            .HasColumnName("tenant_id").HasMaxLength(64).IsRequired(false);
        app.Property<string?>("_workspaceId")
            .HasColumnName("workspace_id").HasMaxLength(64).IsRequired(false);
        app.Property<string?>("_accountPrincipalId")
            .HasColumnName("account_principal_id")
            .HasMaxLength(256)
            .IsRequired(false);
        app.Property<string>("_placementId")
            .HasColumnName("placement_id").HasMaxLength(64).IsRequired();
        app.Property<string>("_packageId")
            .HasColumnName("package_id").HasMaxLength(128).IsRequired();
        app.Property<long>("_initialPackageGeneration")
            .HasColumnName("initial_package_generation").IsRequired();
        app.Property<long>("_desiredPackageGeneration")
            .HasColumnName("desired_package_generation").IsRequired();
        app.Property<long>("_revision")
            .HasColumnName("revision").IsConcurrencyToken().IsRequired();
        app.Property(value => value.CreatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("created_at_unix_ms")
            .IsRequired();
        app.Property(value => value.UpdatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("updated_at_unix_ms")
            .IsRequired();
        app.HasIndex("_packageId", "_initialPackageGeneration");
        app.HasIndex("_packageId", "_desiredPackageGeneration");
        app.HasOne<PackageDeclaration>()
            .WithMany()
            .HasForeignKey("_packageId", "_initialPackageGeneration")
            .OnDelete(DeleteBehavior.Restrict);
        app.HasOne<PackageDeclaration>()
            .WithMany()
            .HasForeignKey("_packageId", "_desiredPackageGeneration")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
