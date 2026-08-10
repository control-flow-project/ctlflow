using CtlFlow.Identity.Identityd.Domain.Providers;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.LoginProviders;

internal static partial class LoginProviderSchema
{
    internal static void ConfigureWorkspaceLoginProviderAdmission(
        ModelBuilder modelBuilder)
    {
        var admission =
            modelBuilder.Entity<WorkspaceLoginProviderAdmission>();
        admission.ToTable("workspace_login_provider_admissions");
        admission.Ignore(value => value.TenantId);
        admission.Ignore(value => value.WorkspaceId);
        admission.Ignore(value => value.ProviderId);
        admission.HasKey("_tenantId", "_workspaceId", "_providerId");

        admission.Property<string>("_tenantId")
            .HasColumnName("tenant_id")
            .HasMaxLength(64)
            .IsRequired();
        admission.Property<string>("_workspaceId")
            .HasColumnName("workspace_id")
            .HasMaxLength(64)
            .IsRequired();
        admission.Property<string>("_providerId")
            .HasColumnName("provider_id")
            .HasMaxLength(64)
            .IsRequired();

        admission.HasIndex("_tenantId", "_workspaceId", "_providerId")
            .HasDatabaseName(
                "workspace_login_provider_admissions_page_idx");
        admission.HasOne<LoginProvider>()
            .WithMany()
            .HasForeignKey("_tenantId", "_providerId")
            .HasPrincipalKey("_tenantId", "_providerId")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
