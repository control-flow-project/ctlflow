using CtlFlow.Policy.Policyd.Db.Schema;
using CtlFlow.Policy.Policyd.Domain.Grants;
using CtlFlow.Policy.Policyd.Domain.Roles;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Policy.Policyd.Db.Grants.AccessGrantSchema;
using static CtlFlow.Policy.Policyd.Db.Roles.RoleSchema;
using static CtlFlow.Policy.Policyd.Db.Schema.AppliedMigrationSchema;

namespace CtlFlow.Policy.Policyd.Db;

public sealed class PolicyDbContext(DbContextOptions<PolicyDbContext> options)
    : DbContext(options)
{
    public DbSet<Role> Roles { get; private set; } = null!;

    public DbSet<RoleRule> RoleRules { get; private set; } = null!;

    public DbSet<RoleBinding> RoleBindings { get; private set; } = null!;

    public DbSet<AccessGrant> AccessGrants { get; private set; } = null!;

    public DbSet<AppliedMigration> AppliedMigrations { get; private set; } =
        null!;

    public DbSet<MigrationLock> MigrationLocks { get; private set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigureRole(modelBuilder);
        ConfigureRoleRule(modelBuilder);
        ConfigureRoleBinding(modelBuilder);
        ConfigureAccessGrant(modelBuilder);
        ConfigureAppliedMigration(modelBuilder);
        ConfigureMigrationLock(modelBuilder);
    }
}
