using CtlFlow.Identity.Identityd.Domain.Groups;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Groups;

internal static partial class GroupSchema
{
    internal static void ConfigureGroup(ModelBuilder modelBuilder)
    {
        var group = modelBuilder.Entity<Group>();
        group.ToTable("groups");
        group.Ignore(value => value.Id);
        group.Ignore(value => value.TenantId);
        group.Ignore(value => value.WorkspaceId);
        group.HasKey("_id");

        group.Property<string>("_id")
            .HasColumnName("group_id")
            .HasMaxLength(64)
            .IsRequired();
        group.Property<string>("_tenantId")
            .HasColumnName("tenant_id")
            .HasMaxLength(64)
            .IsRequired();
        group.Property<string?>("_workspaceId")
            .HasColumnName("workspace_id")
            .HasMaxLength(64);

        group.HasIndex("_tenantId", "_workspaceId", "_id");
    }
}
