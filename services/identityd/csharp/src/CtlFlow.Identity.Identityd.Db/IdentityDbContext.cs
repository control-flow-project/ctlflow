using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Groups;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Keys;
using CtlFlow.Identity.Identityd.Domain.Memberships;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Sessions;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Identity.Identityd.Db.Accounts.AccountSchema;
using static CtlFlow.Identity.Identityd.Db.Groups.GroupSchema;
using static CtlFlow.Identity.Identityd.Db.IdentityLinks.ExternalIdentityLinkSchema;
using static CtlFlow.Identity.Identityd.Db.Keys.VerificationKeySchema;
using static CtlFlow.Identity.Identityd.Db.Memberships.MembershipSchema;
using static CtlFlow.Identity.Identityd.Db.Principals.VirtualPrincipalSchema;
using static CtlFlow.Identity.Identityd.Db.Schema.AppliedMigrationSchema;
using static CtlFlow.Identity.Identityd.Db.Sessions.SessionSchema;

namespace CtlFlow.Identity.Identityd.Db;

public sealed class IdentityDbContext(
    DbContextOptions<IdentityDbContext> options)
    : DbContext(options)
{
    public DbSet<Account> Accounts { get; private set; } = null!;

    public DbSet<VirtualPrincipal> VirtualPrincipals { get; private set; } =
        null!;

    public DbSet<TenantMembership> TenantMemberships { get; private set; } =
        null!;

    public DbSet<WorkspaceMembership> WorkspaceMemberships {
        get;
        private set;
    } = null!;

    public DbSet<Group> Groups { get; private set; } = null!;

    public DbSet<AccountGroupMembership> AccountGroupMemberships {
        get;
        private set;
    } = null!;

    public DbSet<VirtualPrincipalGroupMembership>
        VirtualPrincipalGroupMemberships { get; private set; } = null!;

    public DbSet<InvocationVerificationKey> InvocationVerificationKeys {
        get;
        private set;
    } = null!;

    public DbSet<ExternalIdentityLink> ExternalIdentityLinks {
        get;
        private set;
    } = null!;

    public DbSet<Session> Sessions { get; private set; } = null!;

    public DbSet<AppliedMigration> AppliedMigrations { get; private set; } =
        null!;

    public DbSet<MigrationLock> MigrationLocks { get; private set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigureAccount(modelBuilder);
        ConfigureVirtualPrincipal(modelBuilder);
        ConfigureTenantMembership(modelBuilder);
        ConfigureWorkspaceMembership(modelBuilder);
        ConfigureGroup(modelBuilder);
        ConfigureAccountGroupMembership(modelBuilder);
        ConfigureVirtualPrincipalGroupMembership(modelBuilder);
        ConfigureInvocationVerificationKey(modelBuilder);
        ConfigureExternalIdentityLink(modelBuilder);
        ConfigureSession(modelBuilder);
        ConfigureAppliedMigration(modelBuilder);
        ConfigureMigrationLock(modelBuilder);
    }
}
