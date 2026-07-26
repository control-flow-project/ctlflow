using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Resources;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Principals;

internal static partial class VirtualPrincipalSchema
{
    internal static void ConfigureVirtualPrincipal(ModelBuilder modelBuilder)
    {
        var principal = modelBuilder.Entity<VirtualPrincipal>();
        principal.ToTable("virtual_principals");
        principal.Ignore(value => value.Id);
        principal.Ignore(value => value.SubjectAccountId);
        principal.Ignore(value => value.TenantFenceId);
        principal.Ignore(value => value.WorkspaceFenceId);
        principal.HasKey("_id");

        principal.Property<string>("_id")
            .HasColumnName("principal_id")
            .HasMaxLength(256)
            .IsRequired();
        principal.Property<string>("_subjectAccountId")
            .HasColumnName("subject_account_id")
            .HasMaxLength(256)
            .IsRequired();
        principal.Property(value => value.Enabled)
            .HasColumnName("enabled")
            .IsRequired();
        principal.Property(value => value.Revision)
            .HasConversion(
                value => value.Value,
                value => Revision.FromStorage(value))
            .HasColumnName("revision")
            .IsConcurrencyToken()
            .IsRequired();
        principal.Property<string>("_tenantFenceId")
            .HasColumnName("tenant_fence_id")
            .HasMaxLength(64)
            .IsRequired();
        principal.Property<string?>("_workspaceFenceId")
            .HasColumnName("workspace_fence_id")
            .HasMaxLength(64);

        principal.HasOne<Account>()
            .WithMany()
            .HasForeignKey("_subjectAccountId")
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
