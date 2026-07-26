using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Resources;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Identity.Identityd.Db.Accounts.AccountKinds;

namespace CtlFlow.Identity.Identityd.Db.Accounts;

internal static partial class AccountSchema
{
    internal static void ConfigureAccount(ModelBuilder modelBuilder)
    {
        var account = modelBuilder.Entity<Account>();
        account.ToTable("accounts");
        account.Ignore(value => value.Id);
        account.HasKey("_id");

        account.Property<string>("_id")
            .HasColumnName("account_id")
            .HasMaxLength(256)
            .IsRequired();
        account.Property(value => value.Kind)
            .HasConversion(
                value => ToStorage(value),
                value => FromStorage(value))
            .HasColumnName("kind")
            .IsRequired();
        account.Property(value => value.Enabled)
            .HasColumnName("enabled")
            .IsRequired();
        account.Property(value => value.Revision)
            .HasConversion(
                value => value.Value,
                value => Revision.FromStorage(value))
            .HasColumnName("revision")
            .IsConcurrencyToken()
            .IsRequired();
    }
}
