using CtlFlow.Policy.Policyd.Domain.Roles;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Policy.Policyd.Db.Roles;

internal static partial class RoleSchema
{
    internal static void ConfigureRole(ModelBuilder modelBuilder)
    {
        var role = modelBuilder.Entity<Role>();
        role.ToTable("roles");
        role.Ignore(value => value.Id);
        role.Ignore(value => value.TargetKind);
        role.Ignore(value => value.TenantId);
        role.Ignore(value => value.WorkspaceId);
        role.HasKey("_id");
        role.Property<string>("_id")
            .HasColumnName("role_id")
            .HasMaxLength(128)
            .IsRequired();
        role.Property<int>("_targetKind")
            .HasColumnName("target_kind")
            .IsRequired();
        role.Property<string>("_tenantId")
            .HasColumnName("tenant_id")
            .HasMaxLength(64)
            .IsRequired();
        role.Property<string?>("_workspaceId")
            .HasColumnName("workspace_id")
            .HasMaxLength(64);
    }
}
