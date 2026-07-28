using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace CtlFlow.Configuration.Configd.Db.Bindings;

internal static partial class BindingSchema
{
    internal static void ConfigureBinding<TEntity>(
        EntityTypeBuilder<TEntity> entity)
        where TEntity : class
    {
        entity.Property<int>("_scopeKind")
            .HasColumnName("scope_kind")
            .IsRequired();
        entity.Property<string>("_placementId")
            .HasColumnName("placement_id")
            .HasMaxLength(64)
            .IsRequired();
        entity.Property<string?>("_tenantId")
            .HasColumnName("tenant_id")
            .HasMaxLength(64)
            .IsRequired(false);
        entity.Property<string?>("_workspaceId")
            .HasColumnName("workspace_id")
            .HasMaxLength(64)
            .IsRequired(false);
        entity.Property<string?>("_accountPrincipalId")
            .HasColumnName("account_principal_id")
            .HasMaxLength(256)
            .IsRequired(false);
        entity.Property<string>("_consumerId")
            .HasColumnName("consumer_id")
            .HasMaxLength(64)
            .IsRequired();
        entity.Property<string>("_purpose")
            .HasColumnName("purpose")
            .HasMaxLength(64)
            .IsRequired();
    }
}
