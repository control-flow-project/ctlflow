using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Memberships;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Resources;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.IdentityLinks;

internal static partial class ExternalIdentityLinkSchema
{
    internal static void ConfigureExternalIdentityLink(
        ModelBuilder modelBuilder)
    {
        var link = modelBuilder.Entity<ExternalIdentityLink>();
        link.ToTable("external_identity_links");
        link.Ignore(value => value.AccountId);
        link.Ignore(value => value.ExternalLinkId);
        link.Ignore(value => value.ProviderId);
        link.Ignore(value => value.ProviderSubject);
        link.Ignore(value => value.TenantId);
        link.HasKey("_tenantId", "_providerId", "_providerSubject");

        link.Property<string>("_externalLinkId")
            .HasColumnName("external_link_id")
            .HasMaxLength(36)
            .IsRequired();
        link.Property<string>("_tenantId")
            .HasColumnName("tenant_id")
            .HasMaxLength(64)
            .IsRequired();
        link.Property<string>("_providerId")
            .HasColumnName("provider_id")
            .HasMaxLength(64)
            .IsRequired();
        link.Property<string>("_providerSubject")
            .HasColumnName("provider_subject")
            .HasMaxLength(512)
            .IsRequired();
        link.Property<string>("_accountId")
            .HasColumnName("account_id")
            .HasMaxLength(256)
            .IsRequired();
        link.Property(value => value.Revision)
            .HasConversion(
                value => value.Value,
                value => Revision.FromStorage(value))
            .HasColumnName("revision")
            .IsConcurrencyToken()
            .IsRequired();

        link.HasIndex("_accountId", "_tenantId")
            .HasDatabaseName("external_identity_links_account_idx");
        link.HasIndex("_externalLinkId")
            .IsUnique()
            .HasDatabaseName("external_identity_links_id_unique");
        link.HasOne<TenantMembership>()
            .WithMany()
            .HasForeignKey("_accountId", "_tenantId")
            .HasPrincipalKey("_accountId", "_tenantId")
            .OnDelete(DeleteBehavior.Restrict);
        link.HasOne<LoginProvider>()
            .WithMany()
            .HasForeignKey("_tenantId", "_providerId")
            .HasPrincipalKey("_tenantId", "_providerId")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
