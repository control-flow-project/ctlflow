using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Resources;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Identity.Identityd.Db.LoginProviders.LoginProviderStates;

namespace CtlFlow.Identity.Identityd.Db.LoginProviders;

internal static partial class LoginProviderSchema
{
    internal static void ConfigureLoginProvider(ModelBuilder modelBuilder)
    {
        var provider = modelBuilder.Entity<LoginProvider>();
        provider.ToTable("login_providers");
        provider.Ignore(value => value.TenantId);
        provider.Ignore(value => value.ProviderId);
        provider.Ignore(value => value.DisplayName);
        provider.Ignore(value => value.ConfigurationId);
        provider.Ignore(value => value.ConfigurationVersionId);
        provider.Ignore(value => value.SecretId);
        provider.Ignore(value => value.SecretVersionId);
        provider.HasKey("_tenantId", "_providerId");

        provider.Property<string>("_tenantId")
            .HasColumnName("tenant_id")
            .HasMaxLength(64)
            .IsRequired();
        provider.Property<string>("_providerId")
            .HasColumnName("provider_id")
            .HasMaxLength(64)
            .IsRequired();
        provider.Property<string>("_displayName")
            .HasColumnName("display_name")
            .HasMaxLength(128)
            .IsRequired();
        provider.Property<string>("_configurationId")
            .HasColumnName("configuration_id")
            .HasMaxLength(64)
            .IsRequired();
        provider.Property<string>("_configurationVersionId")
            .HasColumnName("configuration_version_id")
            .HasMaxLength(64)
            .IsRequired();
        provider.Property<string>("_secretId")
            .HasColumnName("secret_id")
            .HasMaxLength(64)
            .IsRequired();
        provider.Property<string>("_secretVersionId")
            .HasColumnName("secret_version_id")
            .HasMaxLength(64)
            .IsRequired();
        provider.Property(value => value.State)
            .HasConversion(
                value => ToStorage(value),
                value => FromStorage(value))
            .HasColumnName("state")
            .IsRequired();
        provider.Property(value => value.Revision)
            .HasConversion(
                value => value.Value,
                value => Revision.FromStorage(value))
            .HasColumnName("revision")
            .IsConcurrencyToken()
            .IsRequired();

        provider.HasIndex("_tenantId", "_providerId", "State")
            .HasDatabaseName("login_providers_page_idx");
    }
}
