using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Sessions;
using CtlFlow.Identity.Identityd.Domain.Time;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Sessions;

internal static partial class SessionSchema
{
    internal static void ConfigureSession(ModelBuilder modelBuilder)
    {
        var session = modelBuilder.Entity<Session>();
        session.ToTable("sessions");
        session.Ignore(value => value.Id);
        session.Ignore(value => value.CredentialDigest);
        session.Ignore(value => value.AccountId);
        session.Ignore(value => value.TenantId);
        session.Ignore(value => value.ProviderId);
        session.HasKey("_id");

        session.Property<string>("_id")
            .HasColumnName("session_id")
            .HasMaxLength(32)
            .IsRequired();
        session.Property<string>("_credentialDigest")
            .HasColumnName("credential_digest")
            .HasMaxLength(64)
            .IsRequired();
        session.Property<string>("_accountId")
            .HasColumnName("account_id")
            .HasMaxLength(256)
            .IsRequired();
        session.Property<string>("_tenantId")
            .HasColumnName("tenant_id")
            .HasMaxLength(64)
            .IsRequired();
        session.Property<string>("_providerId")
            .HasColumnName("provider_id")
            .HasMaxLength(64)
            .IsRequired();
        session.Property(value => value.CreatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("created_at_unix_ms")
            .IsRequired();
        session.Property(value => value.ExpiresAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("expires_at_unix_ms")
            .IsRequired();
        session.Property(value => value.RevokedAt)
            .HasConversion(
                value => value == null
                    ? (long?)null
                    : value.UnixMilliseconds,
                value => value == null
                    ? null
                    : UtcInstant.FromStorage(value.Value))
            .HasColumnName("revoked_at_unix_ms")
            .IsRequired(false);
        session.Property(value => value.Revision)
            .HasConversion(
                value => value.Value,
                value => Revision.FromStorage(value))
            .HasColumnName("revision")
            .IsConcurrencyToken()
            .IsRequired();

        session.HasIndex("_credentialDigest").IsUnique();
        session.HasIndex("_accountId", "_tenantId")
            .HasDatabaseName("sessions_account_idx");
        session.HasOne<Account>()
            .WithMany()
            .HasForeignKey("_accountId")
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
        session.HasOne<LoginProvider>()
            .WithMany()
            .HasForeignKey("_tenantId", "_providerId")
            .HasPrincipalKey("_tenantId", "_providerId")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
