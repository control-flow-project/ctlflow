using CtlFlow.Configuration.Configd.Domain.Configurations;
using CtlFlow.Configuration.Configd.Domain.Time;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Configuration.Configd.Db.Bindings.BindingSchema;
using ConfigurationEntity =
    CtlFlow.Configuration.Configd.Domain.Configurations.ConfigurationResource;

namespace CtlFlow.Configuration.Configd.Db.Configurations;

internal static partial class ConfigurationSchema
{
    internal static void ConfigureConfiguration(ModelBuilder modelBuilder)
    {
        var configuration = modelBuilder.Entity<ConfigurationEntity>();
        configuration.ToTable("configurations");
        configuration.Ignore(value => value.Id);
        configuration.Ignore(value => value.Binding);
        configuration.Ignore(value => value.CurrentVersionId);
        configuration.Ignore(value => value.Revision);
        configuration.HasKey("_configurationId");
        configuration.Property<string>("_configurationId")
            .HasColumnName("configuration_id")
            .HasMaxLength(64)
            .ValueGeneratedNever()
            .IsRequired();
        ConfigureBinding(configuration);
        configuration.Property<string>("_currentConfigurationVersionId")
            .HasColumnName("current_configuration_version_id")
            .HasMaxLength(64)
            .IsRequired();
        configuration.Property<long>("_revision")
            .HasColumnName("revision")
            .IsConcurrencyToken()
            .IsRequired();
        configuration.Property(value => value.CreatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("created_at_unix_ms")
            .IsRequired();
        configuration.Property(value => value.UpdatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("updated_at_unix_ms")
            .IsRequired();
    }
}
