using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Groups;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Groups;

internal static partial class GroupSchema
{
    internal static void ConfigureAccountGroupMembership(
        ModelBuilder modelBuilder)
    {
        var membership = modelBuilder.Entity<AccountGroupMembership>();
        membership.ToTable("account_group_memberships");
        membership.Ignore(value => value.AccountId);
        membership.Ignore(value => value.GroupId);
        membership.HasKey("_accountId", "_groupId");

        membership.Property<string>("_accountId")
            .HasColumnName("account_id")
            .HasMaxLength(256)
            .IsRequired();
        membership.Property<string>("_groupId")
            .HasColumnName("group_id")
            .HasMaxLength(64)
            .IsRequired();

        membership.HasOne<Account>()
            .WithMany()
            .HasForeignKey("_accountId")
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
        membership.HasOne<Group>()
            .WithMany()
            .HasForeignKey("_groupId")
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
