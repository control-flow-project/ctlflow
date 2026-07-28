using CtlFlow.Configuration.Configd.Db.Content;
using CtlFlow.Configuration.Configd.Db.Custody;
using CtlFlow.Configuration.Configd.Db.Schema;
using CtlFlow.Configuration.Configd.Domain.Configurations;
using CtlFlow.Configuration.Configd.Domain.Projections;
using CtlFlow.Configuration.Configd.Domain.Secrets;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Configuration.Configd.Db.Configurations.ConfigurationSchema;
using static CtlFlow.Configuration.Configd.Db.Content.ConfigurationContentSchema;
using static CtlFlow.Configuration.Configd.Db.Custody.SecretCustodySchema;
using static CtlFlow.Configuration.Configd.Db.Projections.ProjectionSchema;
using static CtlFlow.Configuration.Configd.Db.Schema.AppliedMigrationSchema;
using static CtlFlow.Configuration.Configd.Db.Secrets.SecretSchema;
using ConfigurationEntity =
    CtlFlow.Configuration.Configd.Domain.Configurations.ConfigurationResource;

namespace CtlFlow.Configuration.Configd.Db;

public sealed class ConfigurationDbContext(
    DbContextOptions<ConfigurationDbContext> options)
    : DbContext(options)
{
    public DbSet<ConfigurationEntity> Configurations { get; private set; } =
        null!;

    public DbSet<Secret> Secrets { get; private set; } = null!;

    public DbSet<Projection> Projections { get; private set; } = null!;

    public DbSet<ProjectionTargetEntry> ProjectionTargets
        { get; private set; } = null!;

    public DbSet<AppliedMigration> AppliedMigrations { get; private set; } =
        null!;

    public DbSet<MigrationLock> MigrationLocks { get; private set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigureConfiguration(modelBuilder);
        ConfigureConfigurationVersionContent(modelBuilder);
        ConfigureSecret(modelBuilder);
        ConfigureSecretVersionEnvelope(modelBuilder);
        ConfigureProjection(modelBuilder);
        ConfigureProjectionTargetEntry(modelBuilder);
        ConfigureAppliedMigration(modelBuilder);
        ConfigureMigrationLock(modelBuilder);
    }
}
