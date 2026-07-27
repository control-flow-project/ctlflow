using Microsoft.EntityFrameworkCore;
using CtlFlow.Audit.Auditd.Db;

namespace CtlFlow.Audit.Auditd.Db.Schema;

internal static partial class AppliedMigrationSchema
{
    internal static void ConfigureAppliedMigration(ModelBuilder modelBuilder)
    {
        var migration = modelBuilder.Entity<AppliedMigration>();
        migration.ToTable("knex_migrations", table => table.ExcludeFromMigrations());
        migration.HasKey(value => value.Id);

        migration.Property(value => value.Id)
            .HasColumnName("id")
            .ValueGeneratedOnAdd();

        migration.Property(value => value.Name)
            .HasColumnName("name")
            .HasMaxLength(255)
            .IsRequired(false);
    }
}
