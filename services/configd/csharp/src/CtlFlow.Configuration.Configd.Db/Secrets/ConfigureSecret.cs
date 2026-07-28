using CtlFlow.Configuration.Configd.Domain.Secrets;
using CtlFlow.Configuration.Configd.Domain.Time;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Configuration.Configd.Db.Bindings.BindingSchema;

namespace CtlFlow.Configuration.Configd.Db.Secrets;

internal static partial class SecretSchema
{
    internal static void ConfigureSecret(ModelBuilder modelBuilder)
    {
        var secret = modelBuilder.Entity<Secret>();
        secret.ToTable("secrets");
        secret.Ignore(value => value.Id);
        secret.Ignore(value => value.Binding);
        secret.Ignore(value => value.CurrentVersionId);
        secret.Ignore(value => value.Revision);
        secret.HasKey("_secretId");
        secret.Property<string>("_secretId")
            .HasColumnName("secret_id")
            .HasMaxLength(64)
            .ValueGeneratedNever()
            .IsRequired();
        ConfigureBinding(secret);
        secret.Property<string>("_currentSecretVersionId")
            .HasColumnName("current_secret_version_id")
            .HasMaxLength(64)
            .IsRequired();
        secret.Property<long>("_revision")
            .HasColumnName("revision")
            .IsConcurrencyToken()
            .IsRequired();
        secret.Property(value => value.CreatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("created_at_unix_ms")
            .IsRequired();
        secret.Property(value => value.UpdatedAt)
            .HasConversion(
                value => value.UnixMilliseconds,
                value => UtcInstant.FromStorage(value))
            .HasColumnName("updated_at_unix_ms")
            .IsRequired();
    }
}
