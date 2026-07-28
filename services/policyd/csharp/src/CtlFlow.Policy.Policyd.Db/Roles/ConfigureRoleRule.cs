using CtlFlow.Policy.Policyd.Domain.Roles;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Policy.Policyd.Db.Roles;

internal static partial class RoleSchema
{
    internal static void ConfigureRoleRule(ModelBuilder modelBuilder)
    {
        var rule = modelBuilder.Entity<RoleRule>();
        rule.ToTable("role_rules");
        rule.Ignore(value => value.RoleId);
        rule.Ignore(value => value.Operation);
        rule.Ignore(value => value.BasePath);
        rule.Ignore(value => value.MatchKind);
        rule.HasKey("_roleId", "_operation", "_basePath", "_matchKind");
        rule.Property<string>("_roleId")
            .HasColumnName("role_id")
            .HasMaxLength(128)
            .IsRequired();
        rule.Property<string>("_operation")
            .HasColumnName("operation")
            .HasMaxLength(128)
            .IsRequired();
        rule.Property<string>("_basePath")
            .HasColumnName("base_path")
            .HasMaxLength(512)
            .IsRequired();
        rule.Property<int>("_matchKind")
            .HasColumnName("match_kind")
            .IsRequired();
        rule.HasOne<Role>()
            .WithMany()
            .HasForeignKey("_roleId")
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
        rule.HasIndex("_operation", "_roleId")
            .HasDatabaseName("role_rules_operation_role_idx");
    }
}
