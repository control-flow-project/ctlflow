using CtlFlow.Tenancy.Tenantd.Db.AuditOutbox;
using CtlFlow.Tenancy.Tenantd.Db.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Db.Provisioning;
using CtlFlow.Tenancy.Tenantd.Db.Requests;
using CtlFlow.Tenancy.Tenantd.Db.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Db.Schema;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Addresses.AddressBindingSchema;
using static CtlFlow.Tenancy.Tenantd.Db.AuditOutbox.AuditOutboxSchema;
using static CtlFlow.Tenancy.Tenantd.Db.Lifecycles.LifecycleSchema;
using static CtlFlow.Tenancy.Tenantd.Db.Provisioning.ProvisioningSchema;
using static CtlFlow.Tenancy.Tenantd.Db.Requests.RequestSchema;
using static CtlFlow.Tenancy.Tenantd.Db.Resources.ResourceSchema;
using static CtlFlow.Tenancy.Tenantd.Db.Sequences.SequenceSchema;
using static CtlFlow.Tenancy.Tenantd.Db.Schema.AppliedMigrationSchema;
using static CtlFlow.Tenancy.Tenantd.Db.Tenants.TenantSchema;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.WorkspaceSchema;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.WorkspaceAddressBindingSchema;

namespace CtlFlow.Tenancy.Tenantd.Db;

public sealed class TenantDbContext(DbContextOptions<TenantDbContext> options)
    : DbContext(options)
{
    public DbSet<Tenant> Tenants { get; private set; } = null!;

    public DbSet<TenantAddressBinding> TenantAddressBindings { get; private set; } = null!;

    public DbSet<Workspace> Workspaces { get; private set; } = null!;

    public DbSet<WorkspaceAddressBinding> WorkspaceAddressBindings { get; private set; } = null!;

    public DbSet<LifecycleOperation> LifecycleOperations { get; private set; } = null!;

    public DbSet<LifecycleStep> LifecycleSteps { get; private set; } = null!;

    public DbSet<LifecycleDelivery> LifecycleDeliveries { get; private set; } = null!;

    public DbSet<LifecyclePageCursor> LifecyclePageCursors { get; private set; } = null!;

    public DbSet<Sequences.LifecycleDeliverySequenceState>
        LifecycleDeliverySequences { get; private set; } = null!;

    public DbSet<Sequences.ResourceEventSequenceState>
        ResourceEventSequences { get; private set; } = null!;

    public DbSet<ResourceEvent> ResourceEvents { get; private set; } = null!;

    public DbSet<ResourceEventCondition> ResourceEventConditions
        { get; private set; } = null!;

    public DbSet<PageCursor> PageCursors { get; private set; } = null!;

    public DbSet<IdempotencyRecord> IdempotencyRecords { get; private set; } = null!;

    public DbSet<AuditOutboxEntry> AuditOutbox { get; private set; } = null!;

    public DbSet<AuditOutboxState> AuditOutboxStates { get; private set; } = null!;

    public DbSet<TenantInitialAdministrator> TenantInitialAdministrators
        { get; private set; } = null!;

    public DbSet<TenantBaselinePackage> TenantBaselinePackages
        { get; private set; } = null!;

    public DbSet<WorkspaceInitialMembership> WorkspaceInitialMemberships
        { get; private set; } = null!;

    public DbSet<WorkspaceBaselinePackage> WorkspaceBaselinePackages
        { get; private set; } = null!;

    public DbSet<AppliedMigration> AppliedMigrations { get; private set; } = null!;

    public DbSet<MigrationLock> MigrationLocks { get; private set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigureTenant(modelBuilder);
        ConfigureAddressBinding(modelBuilder);
        ConfigureWorkspace(modelBuilder);
        ConfigureWorkspaceAddressBinding(modelBuilder);
        ConfigureLifecycleOperation(modelBuilder);
        ConfigureLifecycleStep(modelBuilder);
        ConfigureLifecycleDelivery(modelBuilder);
        ConfigureLifecyclePageCursor(modelBuilder);
        ConfigureSequences(modelBuilder);
        ConfigureResourceEvent(modelBuilder);
        ConfigureResourceEventCondition(modelBuilder);
        ConfigurePageCursor(modelBuilder);
        ConfigureIdempotencyRecord(modelBuilder);
        ConfigureAuditOutboxEntry(modelBuilder);
        ConfigureAuditOutboxState(modelBuilder);
        ConfigureProvisioningIntent(modelBuilder);
        ConfigureAppliedMigration(modelBuilder);
        ConfigureMigrationLock(modelBuilder);
    }
}
