using CtlFlow.Identity.Identityd.Domain.Memberships;
using CtlFlow.Identity.Identityd.Domain.Resources;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Memberships;

internal static partial class MembershipSchema
{
    internal static void ConfigureWorkspaceMembership(
        ModelBuilder modelBuilder)
    {
        var membership = modelBuilder.Entity<WorkspaceMembership>();
        membership.ToTable("workspace_memberships");
        membership.Ignore(value => value.AccountId);
        membership.Ignore(value => value.TenantId);
        membership.Ignore(value => value.WorkspaceId);
        membership.HasKey("_accountId", "_tenantId", "_workspaceId");

        membership.Property<string>("_accountId")
            .HasColumnName("account_id")
            .HasMaxLength(256)
            .IsRequired();
        membership.Property<string>("_tenantId")
            .HasColumnName("tenant_id")
            .HasMaxLength(64)
            .IsRequired();
        membership.Property<string>("_workspaceId")
            .HasColumnName("workspace_id")
            .HasMaxLength(64)
            .IsRequired();
        membership.Property(value => value.Revision)
            .HasConversion(
                value => value.Value,
                value => Revision.FromStorage(value))
            .HasColumnName("revision")
            .IsConcurrencyToken()
            .IsRequired();

        membership.HasIndex(
            "_tenantId",
            "_workspaceId",
            "_accountId");
        membership.HasOne<TenantMembership>()
            .WithMany()
            .HasForeignKey("_accountId", "_tenantId")
            .HasPrincipalKey("_accountId", "_tenantId")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
