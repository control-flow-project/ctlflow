using CtlFlow.Identity.Identityd.Domain.Keys;
using CtlFlow.Identity.Identityd.Domain.Resources;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Identity.Identityd.Db.Keys.VerificationKeyValues;

namespace CtlFlow.Identity.Identityd.Db.Keys;

internal static partial class VerificationKeySchema
{
    internal static void ConfigureInvocationVerificationKey(
        ModelBuilder modelBuilder)
    {
        var key = modelBuilder.Entity<InvocationVerificationKey>();
        key.ToTable("invocation_verification_keys");
        key.Ignore(value => value.Id);
        key.Ignore(value => value.Modulus);
        key.Ignore(value => value.Exponent);
        key.HasKey("_id");

        key.Property<string>("_id")
            .HasColumnName("key_id")
            .HasMaxLength(128)
            .IsRequired();
        key.Property(value => value.Algorithm)
            .HasConversion(
                value => ToStorage(value),
                value => AlgorithmFromStorage(value))
            .HasColumnName("algorithm")
            .HasMaxLength(8)
            .IsRequired();
        key.Property<string>("_modulus")
            .HasColumnName("modulus_base64url")
            .HasMaxLength(1368)
            .IsRequired();
        key.Property<string>("_exponent")
            .HasColumnName("exponent_base64url")
            .HasMaxLength(16)
            .IsRequired();
        key.Property(value => value.State)
            .HasConversion(
                value => ToStorage(value),
                value => StateFromStorage(value))
            .HasColumnName("state")
            .IsRequired();
        key.Property(value => value.Revision)
            .HasConversion(
                value => value.Value,
                value => Revision.FromStorage(value))
            .HasColumnName("revision")
            .IsConcurrencyToken()
            .IsRequired();

        key.HasIndex("State", "_id")
            .HasDatabaseName(
                "invocation_verification_keys_current_idx");
    }
}
