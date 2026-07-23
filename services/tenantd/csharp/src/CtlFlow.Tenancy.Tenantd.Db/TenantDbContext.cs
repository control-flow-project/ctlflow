using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Db.Schema;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Addresses.AddressBindingSchema;
using static CtlFlow.Tenancy.Tenantd.Db.Schema.AppliedMigrationSchema;
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.TenantSchema;

namespace CtlFlow.Tenancy.Tenantd.Db;

public sealed class TenantDbContext(DbContextOptions<TenantDbContext> options)
    : DbContext(options)
{
    public DbSet<Tenant> Tenants { get; private set; } = null!;

    public DbSet<TenantAddressBinding> TenantAddressBindings { get; private set; } = null!;

    public DbSet<AppliedMigration> AppliedMigrations { get; private set; } = null!;

    public DbSet<MigrationLock> MigrationLocks { get; private set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigureTenant(modelBuilder);
        ConfigureAddressBinding(modelBuilder);
        ConfigureAppliedMigration(modelBuilder);
        ConfigureMigrationLock(modelBuilder);
    }
}
