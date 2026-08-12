using CtlFlow.Audit.Auditd.Db.Schema;
using CtlFlow.Audit.Auditd.Domain.Details;
using CtlFlow.Audit.Auditd.Domain.Events;
using CtlFlow.Audit.Auditd.Domain.Partitions;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Audit.Auditd.Db.Events.AuditEventSchema;
using static CtlFlow.Audit.Auditd.Db.Schema.AppliedMigrationSchema;

namespace CtlFlow.Audit.Auditd.Db;

public sealed class AuditDbContext(DbContextOptions<AuditDbContext> options)
    : DbContext(options)
{
    public DbSet<AuditRecord> AuditEvents { get; private set; } = null!;

    public DbSet<AuditPartitionHead> PartitionHeads { get; private set; } =
        null!;

    public DbSet<TenantMutationAuditDetail> TenantMutationDetails
    {
        get;
        private set;
    } = null!;

    public DbSet<WorkspaceMutationAuditDetail> WorkspaceMutationDetails
    {
        get;
        private set;
    } = null!;

    public DbSet<IdentitySessionAuditDetail> IdentitySessionDetails
    {
        get;
        private set;
    } = null!;

    public DbSet<IdentityMembershipAuditDetail> IdentityMembershipDetails
    {
        get;
        private set;
    } = null!;

    public DbSet<IdentityGroupAuditDetail> IdentityGroupDetails
    {
        get;
        private set;
    } = null!;

    public DbSet<IdentityGroupMemberAuditDetail> IdentityGroupMemberDetails
    {
        get;
        private set;
    } = null!;

    public DbSet<IdentityVirtualPrincipalAuditDetail>
        IdentityVirtualPrincipalDetails
    { get; private set; } = null!;

    public DbSet<IdentityExternalLinkAuditDetail> IdentityExternalLinkDetails
    {
        get;
        private set;
    } = null!;

    public DbSet<IdentityLoginProviderAuditDetail>
        IdentityLoginProviderDetails
    { get; private set; } = null!;

    public DbSet<IdentityWorkspaceProviderAdmissionAuditDetail>
        IdentityWorkspaceProviderAdmissionDetails
    { get; private set; } = null!;

    public DbSet<PackageDeclarationAuditDetail> PackageDeclarationDetails
    {
        get;
        private set;
    } = null!;

    public DbSet<AppMutationAuditDetail> AppMutationDetails
    {
        get;
        private set;
    } = null!;

    public DbSet<ConfigurationPublicationAuditDetail>
        ConfigurationPublicationDetails
    { get; private set; } = null!;

    public DbSet<SecretPublicationAuditDetail> SecretPublicationDetails
    {
        get;
        private set;
    } = null!;

    public DbSet<ProjectionMutationAuditDetail> ProjectionMutationDetails
    {
        get;
        private set;
    } = null!;

    public DbSet<PlacementMutationAuditDetail> PlacementMutationDetails
    {
        get;
        private set;
    } = null!;

    public DbSet<WorkloadMutationAuditDetail> WorkloadMutationDetails
    {
        get;
        private set;
    } = null!;

    public DbSet<RunMutationAuditDetail> RunMutationDetails
    {
        get;
        private set;
    } = null!;

    public DbSet<AppliedMigration> AppliedMigrations { get; private set; } =
        null!;

    public DbSet<MigrationLock> MigrationLocks { get; private set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigureAuditRecord(modelBuilder);
        ConfigureAuditPartitionHead(modelBuilder);
        ConfigureTenantMutation(modelBuilder);
        ConfigureWorkspaceMutation(modelBuilder);
        ConfigureIdentitySession(modelBuilder);
        ConfigureIdentityMembership(modelBuilder);
        ConfigureIdentityGroup(modelBuilder);
        ConfigureIdentityGroupMember(modelBuilder);
        ConfigureIdentityVirtualPrincipal(modelBuilder);
        ConfigureIdentityExternalLink(modelBuilder);
        ConfigureIdentityLoginProvider(modelBuilder);
        ConfigureIdentityWorkspaceProviderAdmission(modelBuilder);
        ConfigurePackageDeclaration(modelBuilder);
        ConfigureAppMutation(modelBuilder);
        ConfigureConfigurationPublication(modelBuilder);
        ConfigureSecretPublication(modelBuilder);
        ConfigureProjectionMutation(modelBuilder);
        ConfigurePlacementMutation(modelBuilder);
        ConfigureWorkloadMutation(modelBuilder);
        ConfigureRunMutation(modelBuilder);
        ConfigureAppliedMigration(modelBuilder);
        ConfigureMigrationLock(modelBuilder);
    }
}
