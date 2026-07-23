using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Schema;

internal static partial class AppliedMigrationSchema
{
    internal static void ConfigureMigrationLock(ModelBuilder modelBuilder)
    {
        var migrationLock = modelBuilder.Entity<MigrationLock>();
        migrationLock.ToTable("knex_migrations_lock");
        migrationLock.HasKey(value => value.Index);
        migrationLock.Property(value => value.Index)
            .HasColumnName("index");
        migrationLock.Property(value => value.IsLocked)
            .HasColumnName("is_locked");
    }
}
