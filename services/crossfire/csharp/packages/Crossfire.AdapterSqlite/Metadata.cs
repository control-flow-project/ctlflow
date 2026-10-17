using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public class SchemaEntry
{
    public string Type { get; set; } = "";
    public string Name { get; set; } = "";
}

public class MigrationEntry
{
    public string Name { get; set; } = "";
}

public class ApplicationIdentity
{
    public long ApplicationId { get; set; }
}

public class SchemaVersion
{
    public long UserVersion { get; set; }
}

public class JournalConfiguration
{
    public string JournalMode { get; set; } = "";
}

public class IntegrityCheck
{
    public string Value { get; set; } = "";
}

public class ForeignKeyViolation
{
    public string Table { get; set; } = "";
}

public sealed partial class CrossfireDbContext
{
    public DbSet<SchemaEntry> SchemaEntries => Set<SchemaEntry>();
    public DbSet<MigrationEntry> AppliedMigrations => Set<MigrationEntry>();
    public DbSet<ApplicationIdentity> ApplicationIdentities => Set<ApplicationIdentity>();
    public DbSet<SchemaVersion> SchemaVersions => Set<SchemaVersion>();
    public DbSet<JournalConfiguration> JournalConfigurations => Set<JournalConfiguration>();
    public DbSet<IntegrityCheck> IntegrityChecks => Set<IntegrityCheck>();
    public DbSet<ForeignKeyViolation> ForeignKeyViolations => Set<ForeignKeyViolation>();

    private static void ConfigureMetadata(ModelBuilder model)
    {
        model.Entity<SchemaEntry>(entity =>
        {
            entity.HasNoKey().ToView("sqlite_schema");
            entity.Property(row => row.Type).HasColumnName("type");
            entity.Property(row => row.Name).HasColumnName("name");
        });
        model.Entity<MigrationEntry>(entity =>
        {
            entity.HasNoKey().ToView("knex_migrations");
            entity.Property(row => row.Name).HasColumnName("name");
        });
        model.Entity<ApplicationIdentity>(entity =>
        {
            entity.HasNoKey().ToView("pragma_application_id");
            entity.Property(row => row.ApplicationId).HasColumnName("application_id");
        });
        model.Entity<SchemaVersion>(entity =>
        {
            entity.HasNoKey().ToView("pragma_user_version");
            entity.Property(row => row.UserVersion).HasColumnName("user_version");
        });
        model.Entity<JournalConfiguration>(entity =>
        {
            entity.HasNoKey().ToView("pragma_journal_mode");
            entity.Property(row => row.JournalMode).HasColumnName("journal_mode");
        });
        model.Entity<IntegrityCheck>(entity =>
        {
            entity.HasNoKey().ToView("pragma_integrity_check");
            entity.Property(row => row.Value).HasColumnName("integrity_check");
        });
        model.Entity<ForeignKeyViolation>(entity =>
        {
            entity.HasNoKey().ToView("pragma_foreign_key_check");
            entity.Property(row => row.Table).HasColumnName("table");
        });
    }
}

public static class Metadata
{
    public static long Application(CrossfireDbContext context) => context.ApplicationIdentities.Select(row => row.ApplicationId).Single();
    public static long Version(CrossfireDbContext context) => context.SchemaVersions.Select(row => row.UserVersion).Single();
    public static bool HasMigrations(CrossfireDbContext context) => context.SchemaEntries.Any(row => row.Type == "table" && row.Name == "knex_migrations");
    public static string[] Migrations(CrossfireDbContext context) => context.AppliedMigrations.OrderBy(row => row.Name).Select(row => row.Name).ToArray();
    public static string Journal(CrossfireDbContext context) => context.JournalConfigurations.Select(row => row.JournalMode).Single();
    public static bool Valid(CrossfireDbContext context) => context.IntegrityChecks.Select(row => row.Value).ToArray() is ["ok"]
        && !context.ForeignKeyViolations.Any();
    public static bool Empty(CrossfireDbContext context) => !context.SchemaEntries.Any(row => row.Type == "table"
        && !row.Name.StartsWith("sqlite_") && row.Name != "knex_migrations" && row.Name != "knex_migrations_lock")
        && (!HasMigrations(context) || !context.AppliedMigrations.Any());
}
