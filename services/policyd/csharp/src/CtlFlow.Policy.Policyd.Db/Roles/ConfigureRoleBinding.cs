using CtlFlow.Policy.Policyd.Domain.Roles;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Policy.Policyd.Db.Roles;

internal static partial class RoleSchema
{
    internal static void ConfigureRoleBinding(ModelBuilder modelBuilder)
    {
        var binding = modelBuilder.Entity<RoleBinding>();
        binding.ToTable("role_bindings");
        binding.Ignore(value => value.RoleId);
        binding.Ignore(value => value.SubjectKind);
        binding.Ignore(value => value.SubjectId);
        binding.HasKey("_roleId", "_subjectKind", "_subjectId");
        binding.Property<string>("_roleId")
            .HasColumnName("role_id")
            .HasMaxLength(128)
            .IsRequired();
        binding.Property<int>("_subjectKind")
            .HasColumnName("subject_kind")
            .IsRequired();
        binding.Property<string>("_subjectId")
            .HasColumnName("subject_id")
            .HasMaxLength(256)
            .IsRequired();
        binding.HasOne<Role>()
            .WithMany()
            .HasForeignKey("_roleId")
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
        binding.HasIndex("_subjectKind", "_subjectId", "_roleId")
            .HasDatabaseName("role_bindings_subject_role_idx");
    }
}
