using CtlFlow.Tenancy.Tenantd.Db.Schema;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Schema.AppliedMigrationSchema;
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.TenantSchema;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.WorkspaceSchema;

namespace CtlFlow.Tenancy.Tenantd.Db;

public sealed class TenantDbContext(DbContextOptions<TenantDbContext> options)
    : DbContext(options)
{
    public DbSet<Tenant> Tenants { get; private set; } = null!;

    public DbSet<Workspace> Workspaces { get; private set; } = null!;

    public DbSet<AppliedMigration> AppliedMigrations { get; private set; } = null!;

    public DbSet<MigrationLock> MigrationLocks { get; private set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigureTenant(modelBuilder);
        ConfigureWorkspace(modelBuilder);
        ConfigureAppliedMigration(modelBuilder);
        ConfigureMigrationLock(modelBuilder);
    }
}
