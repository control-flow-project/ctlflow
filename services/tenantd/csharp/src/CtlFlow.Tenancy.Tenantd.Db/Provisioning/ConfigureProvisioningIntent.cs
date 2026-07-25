using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Provisioning;

internal static class ProvisioningSchema
{
    internal static void ConfigureProvisioningIntent(ModelBuilder modelBuilder)
    {
        ConfigureTenantAdministrator(modelBuilder);
        ConfigureTenantPackages(modelBuilder);
        ConfigureWorkspaceMemberships(modelBuilder);
        ConfigureWorkspacePackages(modelBuilder);
    }

    private static void ConfigureTenantAdministrator(
        ModelBuilder modelBuilder)
    {
        var administrator =
            modelBuilder.Entity<TenantInitialAdministrator>();
        administrator.ToTable("tenant_initial_administrators");
        administrator.HasKey(value => value.TenantId);
        administrator.Property(value => value.TenantId)
            .HasColumnName("tenant_id")
            .HasMaxLength(64);
        administrator.Property(value => value.DisplayName)
            .HasColumnName("display_name")
            .HasMaxLength(200);
        administrator.Property(value => value.LoginIdentifier)
            .HasColumnName("login_identifier")
            .HasMaxLength(320);
        administrator.Property(value => value.ProviderId)
            .HasColumnName("provider_id")
            .HasMaxLength(64);
        administrator.Property(value => value.ProviderSubject)
            .HasColumnName("provider_subject")
            .HasMaxLength(512);
        administrator.HasOne<Tenant>()
            .WithOne()
            .HasForeignKey<TenantInitialAdministrator>(
                value => value.TenantId)
            .HasPrincipalKey<Tenant>("_id")
            .OnDelete(DeleteBehavior.Restrict);
    }

    private static void ConfigureTenantPackages(ModelBuilder modelBuilder)
    {
        var package = modelBuilder.Entity<TenantBaselinePackage>();
        package.ToTable("tenant_baseline_packages");
        package.HasKey(value => new
        {
            value.TenantId,
            value.PackageId,
            value.PackageVersion
        });
        package.Property(value => value.TenantId)
            .HasColumnName("tenant_id")
            .HasMaxLength(64);
        package.Property(value => value.PackageId)
            .HasColumnName("package_id")
            .HasMaxLength(64);
        package.Property(value => value.PackageVersion)
            .HasColumnName("package_version")
            .HasMaxLength(128);
        package.HasOne<Tenant>()
            .WithMany()
            .HasForeignKey(value => value.TenantId)
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
    }

    private static void ConfigureWorkspaceMemberships(
        ModelBuilder modelBuilder)
    {
        var membership =
            modelBuilder.Entity<WorkspaceInitialMembership>();
        membership.ToTable("workspace_initial_memberships");
        membership.HasKey(value => new
        {
            value.WorkspaceId,
            value.UserId
        });
        membership.Property(value => value.WorkspaceId)
            .HasColumnName("workspace_id")
            .HasMaxLength(64);
        membership.Property(value => value.UserId)
            .HasColumnName("user_id")
            .HasMaxLength(64);
        membership.Property(value => value.Standing)
            .HasColumnName("standing");
        membership.HasOne<Workspace>()
            .WithMany()
            .HasForeignKey(value => value.WorkspaceId)
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
    }

    private static void ConfigureWorkspacePackages(ModelBuilder modelBuilder)
    {
        var package = modelBuilder.Entity<WorkspaceBaselinePackage>();
        package.ToTable("workspace_baseline_packages");
        package.HasKey(value => new
        {
            value.WorkspaceId,
            value.PackageId,
            value.PackageVersion
        });
        package.Property(value => value.WorkspaceId)
            .HasColumnName("workspace_id")
            .HasMaxLength(64);
        package.Property(value => value.PackageId)
            .HasColumnName("package_id")
            .HasMaxLength(64);
        package.Property(value => value.PackageVersion)
            .HasColumnName("package_version")
            .HasMaxLength(128);
        package.HasOne<Workspace>()
            .WithMany()
            .HasForeignKey(value => value.WorkspaceId)
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
