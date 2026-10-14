using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Crossfire.AdapterSqlite.Entities;
using Crossfire.AdapterFilesystem;

namespace Crossfire.AdapterSqlite;

public sealed partial class CrossfireDbContext(string database) : DbContext
{
    public DbSet<PrincipalRow> Principal => Set<PrincipalRow>();
    public DbSet<MemberRow> Member => Set<MemberRow>();
    public DbSet<AgentRow> Agent => Set<AgentRow>();
    public DbSet<AgentCredentialRow> AgentCredential => Set<AgentCredentialRow>();
    public DbSet<PrincipalApplicationRow> PrincipalApplication => Set<PrincipalApplicationRow>();
    public DbSet<PermissionRow> Permission => Set<PermissionRow>();
    public DbSet<RoleRow> Role => Set<RoleRow>();
    public DbSet<RolePermissionRow> RolePermission => Set<RolePermissionRow>();
    public DbSet<PrincipalRoleRow> PrincipalRole => Set<PrincipalRoleRow>();
    public DbSet<EnrollmentRequestRow> EnrollmentRequest => Set<EnrollmentRequestRow>();
    public DbSet<EnrollmentItemRow> EnrollmentItem => Set<EnrollmentItemRow>();
    public DbSet<AgentNameRow> AgentName => Set<AgentNameRow>();
    public DbSet<FleetRow> Fleet => Set<FleetRow>();
    public DbSet<FleetInstanceRow> FleetInstance => Set<FleetInstanceRow>();
    public DbSet<FleetCredentialRow> FleetCredential => Set<FleetCredentialRow>();
    public DbSet<FleetControllerMetadataRow> FleetControllerMetadata => Set<FleetControllerMetadataRow>();
    public DbSet<EnrollmentControllerMetadataRow> EnrollmentControllerMetadata => Set<EnrollmentControllerMetadataRow>();
    public DbSet<AgentRoomGrantRow> AgentRoomGrant => Set<AgentRoomGrantRow>();
    public DbSet<AgentRoomPermissionRow> AgentRoomPermission => Set<AgentRoomPermissionRow>();
    public DbSet<RoomGrantApplicationRow> RoomGrantApplication => Set<RoomGrantApplicationRow>();
    public DbSet<AgentWakeSenderRow> AgentWakeSender => Set<AgentWakeSenderRow>();
    public DbSet<MemberInvitationRow> MemberInvitation => Set<MemberInvitationRow>();
    public DbSet<MemberSessionRow> MemberSession => Set<MemberSessionRow>();
    public DbSet<ListenerRunRow> ListenerRun => Set<ListenerRunRow>();
    public DbSet<WakeNoticeRow> WakeNotice => Set<WakeNoticeRow>();
    public DbSet<InstancePolicyRow> InstancePolicy => Set<InstancePolicyRow>();
    public DbSet<AuditEventRow> AuditEvent => Set<AuditEventRow>();
    public DbSet<FleetConnectionRow> FleetConnection => Set<FleetConnectionRow>();
    public DbSet<FleetMessageRow> FleetMessage => Set<FleetMessageRow>();
    public DbSet<FleetMessageDeliveryRow> FleetMessageDelivery => Set<FleetMessageDeliveryRow>();
    public DbSet<WakeRuleRow> WakeRule => Set<WakeRuleRow>();
    public DbSet<WakeRuleAgentRow> WakeRuleAgent => Set<WakeRuleAgentRow>();
    public DbSet<WakeDeliveryRow> WakeDelivery => Set<WakeDeliveryRow>();
    public DbSet<AgentOwnerConversationRow> AgentOwnerConversation => Set<AgentOwnerConversationRow>();
    public DbSet<RuntimeDecisionRow> RuntimeDecision => Set<RuntimeDecisionRow>();
    public DbSet<RuntimeDecisionQuestionRow> RuntimeDecisionQuestion => Set<RuntimeDecisionQuestionRow>();
    public DbSet<RuntimeDecisionOptionRow> RuntimeDecisionOption => Set<RuntimeDecisionOptionRow>();
    public DbSet<RuntimeDecisionAnswerRow> RuntimeDecisionAnswer => Set<RuntimeDecisionAnswerRow>();
    public DbSet<RuntimeObservationRow> RuntimeObservation => Set<RuntimeObservationRow>();
    public DbSet<RuntimeSettingRow> RuntimeSetting => Set<RuntimeSettingRow>();
    public DbSet<RuntimeIncidentRow> RuntimeIncident => Set<RuntimeIncidentRow>();
    public DbSet<IncidentNotificationRow> IncidentNotification => Set<IncidentNotificationRow>();
    public DbSet<ManagementConversationRow> ManagementConversation => Set<ManagementConversationRow>();
    public DbSet<ListenerStatCheckpointRow> ListenerStatCheckpoint => Set<ListenerStatCheckpointRow>();
    public DbSet<ListenerStatIntervalRow> ListenerStatInterval => Set<ListenerStatIntervalRow>();
    public DbSet<ListenerStatFlowRow> ListenerStatFlow => Set<ListenerStatFlowRow>();
    public DbSet<ListenerStatUsageRow> ListenerStatUsage => Set<ListenerStatUsageRow>();
    public DbSet<RuntimeUsageCheckpointRow> RuntimeUsageCheckpoint => Set<RuntimeUsageCheckpointRow>();
    public DbSet<EnrollmentItemPolicyRow> EnrollmentItemPolicy => Set<EnrollmentItemPolicyRow>();
    public DbSet<EnrollmentItemPermissionRow> EnrollmentItemPermission => Set<EnrollmentItemPermissionRow>();
    public DbSet<EnrollmentItemWakeSenderRow> EnrollmentItemWakeSender => Set<EnrollmentItemWakeSenderRow>();
    public DbSet<FleetInstancePolicyRow> FleetInstancePolicy => Set<FleetInstancePolicyRow>();
    public DbSet<FleetInstancePermissionRow> FleetInstancePermission => Set<FleetInstancePermissionRow>();
    public DbSet<FleetRuntimeOperationRow> FleetRuntimeOperation => Set<FleetRuntimeOperationRow>();
    public DbSet<PublicationRow> Publication => Set<PublicationRow>();
    public DbSet<PublicationFileRow> PublicationFile => Set<PublicationFileRow>();
    public DbSet<EnrollmentArchiveRow> EnrollmentArchive => Set<EnrollmentArchiveRow>();
    public DbSet<EnrollmentArchiveItemRow> EnrollmentArchiveItem => Set<EnrollmentArchiveItemRow>();
    public DbSet<EnrollmentArchivePolicyRow> EnrollmentArchivePolicy => Set<EnrollmentArchivePolicyRow>();
    public DbSet<EnrollmentArchivePermissionRow> EnrollmentArchivePermission => Set<EnrollmentArchivePermissionRow>();
    public DbSet<EnrollmentArchiveWakeSenderRow> EnrollmentArchiveWakeSender => Set<EnrollmentArchiveWakeSenderRow>();
    public DbSet<EnrollmentArchiveMetadataRow> EnrollmentArchiveMetadata => Set<EnrollmentArchiveMetadataRow>();
    public DbSet<FleetNativeStopRow> FleetNativeStop => Set<FleetNativeStopRow>();

    protected override void OnConfiguring(DbContextOptionsBuilder options)
        => options.UseSqlite(new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder
        {
            DataSource = PrivateFiles.Database(database), ForeignKeys = true, DefaultTimeout = 5, Pooling = false
        }.ToString());

    protected override void OnModelCreating(ModelBuilder model)
    {
        ConfigureTables0(model);
        ConfigureTables1(model);
        ConfigureTables2(model);
        ConfigureTables3(model);
        ConfigureTables4(model);
        ConfigureTables5(model);
        ConfigureTables6(model);
        ConfigureForeignKeys(model);
    }
}

public sealed class CrossfireDbContextFactory : IDesignTimeDbContextFactory<CrossfireDbContext>
{
    public CrossfireDbContext CreateDbContext(string[] arguments) => new(":memory:");
}
