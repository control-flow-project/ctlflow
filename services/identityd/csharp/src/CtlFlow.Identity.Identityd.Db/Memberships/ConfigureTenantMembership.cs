using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Memberships;
using CtlFlow.Identity.Identityd.Domain.Resources;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Memberships;

internal static partial class MembershipSchema
{
    internal static void ConfigureTenantMembership(ModelBuilder modelBuilder)
    {
        var membership = modelBuilder.Entity<TenantMembership>();
        membership.ToTable("tenant_memberships");
        membership.Ignore(value => value.AccountId);
        membership.Ignore(value => value.TenantId);
        membership.HasKey("_accountId", "_tenantId");

        membership.Property<string>("_accountId")
            .HasColumnName("account_id")
            .HasMaxLength(256)
            .IsRequired();
        membership.Property<string>("_tenantId")
            .HasColumnName("tenant_id")
            .HasMaxLength(64)
            .IsRequired();
        membership.Property(value => value.Revision)
            .HasConversion(
                value => value.Value,
                value => Revision.FromStorage(value))
            .HasColumnName("revision")
            .IsConcurrencyToken()
            .IsRequired();

        membership.HasIndex("_tenantId", "_accountId");
        membership.HasOne<Account>()
            .WithMany()
            .HasForeignKey("_accountId")
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
