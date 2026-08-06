using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Runs;
using CtlFlow.Execution.Execd.Domain.Workloads;
using CtlFlow.Execution.Execd.Db.Schema;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Execution.Execd.Db.Persistence.ExecutionSchema;
using static CtlFlow.Execution.Execd.Db.Schema.AppliedMigrationSchema;

namespace CtlFlow.Execution.Execd.Db;

public sealed class ExecutionDbContext(DbContextOptions<ExecutionDbContext> options)
    : DbContext(options)
{
    public DbSet<Placement> Placements { get; private set; } = null!;
    public DbSet<PlacementProvisioner> PlacementProvisioners
    {
        get;
        private set;
    } = null!;

    public DbSet<Workload> Workloads { get; private set; } = null!;
    public DbSet<WorkloadConfigTarget> WorkloadConfigTargets
    {
        get;
        private set;
    } = null!;

    public DbSet<WorkloadDependency> WorkloadDependencies
    {
        get;
        private set;
    } = null!;

    public DbSet<WorkloadDependencyParameter> WorkloadDependencyParameters
    {
        get;
        private set;
    } = null!;

    public DbSet<WorkloadDependencyOutput> WorkloadDependencyOutputs
    {
        get;
        private set;
    } = null!;

    public DbSet<WorkloadStorage> WorkloadStorage { get; private set; } =
        null!;

    public DbSet<WorkloadOperation> WorkloadOperations { get; private set; } =
        null!;

    public DbSet<WorkloadInterface> WorkloadInterfaces { get; private set; } =
        null!;

    public DbSet<Domain.Runs.Run> Runs { get; private set; } = null!;
    public DbSet<RunConfigTarget> RunConfigTargets { get; private set; } =
        null!;

    public DbSet<RunDependency> RunDependencies { get; private set; } = null!;
    public DbSet<RunDependencyParameter> RunDependencyParameters
    {
        get;
        private set;
    } = null!;

    public DbSet<RunDependencyOutput> RunDependencyOutputs
    {
        get;
        private set;
    } = null!;

    public DbSet<RunStorage> RunStorage { get; private set; } = null!;
    public DbSet<AppliedMigration> AppliedMigrations { get; private set; } = null!;
    public DbSet<MigrationLock> MigrationLocks { get; private set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigureExecution(modelBuilder);
        ConfigureAppliedMigration(modelBuilder);
        ConfigureMigrationLock(modelBuilder);
    }
}
