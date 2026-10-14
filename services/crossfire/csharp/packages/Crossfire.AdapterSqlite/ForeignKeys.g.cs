using Microsoft.EntityFrameworkCore;
using Crossfire.AdapterSqlite.Entities;

namespace Crossfire.AdapterSqlite;

public sealed partial class CrossfireDbContext
{
    private static void ConfigureForeignKeys(ModelBuilder model)
    {
        model.Entity<MemberRow>().HasOne<PrincipalRow>().WithMany()
            .HasForeignKey("PrincipalId", "PrincipalKind")
            .HasPrincipalKey("Id", "Kind").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AgentRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("OwnerId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AgentRow>().HasOne<PrincipalRow>().WithMany()
            .HasForeignKey("PrincipalId", "PrincipalKind")
            .HasPrincipalKey("Id", "Kind").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AgentCredentialRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<PrincipalApplicationRow>().HasOne<PrincipalRow>().WithMany()
            .HasForeignKey("PrincipalId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<RolePermissionRow>().HasOne<PermissionRow>().WithMany()
            .HasForeignKey("PermissionCode", "GrantScope")
            .HasPrincipalKey("Code", "GrantScope").OnDelete(DeleteBehavior.NoAction);
        model.Entity<RolePermissionRow>().HasOne<RoleRow>().WithMany()
            .HasForeignKey("RoleCode")
            .HasPrincipalKey("Code").OnDelete(DeleteBehavior.NoAction);
        model.Entity<PrincipalRoleRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("AssignedByMemberId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<PrincipalRoleRow>().HasOne<RoleRow>().WithMany()
            .HasForeignKey("RoleCode", "PrincipalKind")
            .HasPrincipalKey("Code", "PrincipalKind").OnDelete(DeleteBehavior.NoAction);
        model.Entity<PrincipalRoleRow>().HasOne<PrincipalRow>().WithMany()
            .HasForeignKey("PrincipalId", "PrincipalKind")
            .HasPrincipalKey("Id", "Kind").OnDelete(DeleteBehavior.NoAction);
        model.Entity<EnrollmentRequestRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("DecidedByMemberId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<EnrollmentRequestRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("OwnerId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<EnrollmentItemRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<EnrollmentItemRow>().HasOne<EnrollmentRequestRow>().WithMany()
            .HasForeignKey("RequestId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AgentNameRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AgentNameRow>().HasOne<EnrollmentItemRow>().WithMany()
            .HasForeignKey("RequestId", "InstanceKey")
            .HasPrincipalKey("RequestId", "InstanceKey").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("OwnerId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetInstanceRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId", "OwnerId")
            .HasPrincipalKey("PrincipalId", "OwnerId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetInstanceRow>().HasOne<FleetRow>().WithMany()
            .HasForeignKey("OwnerId", "FleetKey")
            .HasPrincipalKey("OwnerId", "FleetKey").OnDelete(DeleteBehavior.Cascade);
        model.Entity<FleetCredentialRow>().HasOne<FleetRow>().WithMany()
            .HasForeignKey("FleetId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.Cascade);
        model.Entity<FleetControllerMetadataRow>().HasOne<FleetRow>().WithMany()
            .HasForeignKey("FleetId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.Cascade);
        model.Entity<EnrollmentControllerMetadataRow>().HasOne<EnrollmentRequestRow>().WithMany()
            .HasForeignKey("EnrollmentId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.Cascade);
        model.Entity<AgentRoomGrantRow>().HasOne<PrincipalRow>().WithMany()
            .HasForeignKey("AddedById")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AgentRoomGrantRow>().HasOne<PrincipalRow>().WithMany()
            .HasForeignKey("AuthorizerId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AgentRoomGrantRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AgentRoomPermissionRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("GrantedByMemberId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AgentRoomPermissionRow>().HasOne<PermissionRow>().WithMany()
            .HasForeignKey("PermissionCode", "GrantScope")
            .HasPrincipalKey("Code", "GrantScope").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AgentRoomPermissionRow>().HasOne<AgentRoomGrantRow>().WithMany()
            .HasForeignKey("AgentId", "RoomId", "Generation")
            .HasPrincipalKey("AgentId", "RoomId", "Generation").OnDelete(DeleteBehavior.NoAction);
        model.Entity<RoomGrantApplicationRow>().HasOne<AgentRoomGrantRow>().WithMany()
            .HasForeignKey("AgentId", "RoomId")
            .HasPrincipalKey("AgentId", "RoomId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AgentWakeSenderRow>().HasOne<PrincipalRow>().WithMany()
            .HasForeignKey("SenderPrincipalId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AgentWakeSenderRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<MemberInvitationRow>().HasOne<RoleRow>().WithMany()
            .HasForeignKey("RoleCode", "PrincipalKind")
            .HasPrincipalKey("Code", "PrincipalKind").OnDelete(DeleteBehavior.NoAction);
        model.Entity<MemberInvitationRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("ConsumedByMemberId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<MemberInvitationRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("CreatedByMemberId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<MemberSessionRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("MemberId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<ListenerRunRow>().HasOne<FleetCredentialRow>().WithMany()
            .HasForeignKey("ControllerCredentialId", "ControllerFleetId")
            .HasPrincipalKey("Id", "FleetId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<ListenerRunRow>().HasOne<FleetRow>().WithMany()
            .HasForeignKey("ControllerFleetId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<ListenerRunRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<WakeNoticeRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("ReceiverAgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AuditEventRow>().HasOne<PermissionRow>().WithMany()
            .HasForeignKey("PermissionCode")
            .HasPrincipalKey("Code").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AuditEventRow>().HasOne<PrincipalRow>().WithMany()
            .HasForeignKey("AddedById")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AuditEventRow>().HasOne<PrincipalRow>().WithMany()
            .HasForeignKey("AuthorizerId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AuditEventRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("OwnerId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AuditEventRow>().HasOne<PrincipalRow>().WithMany()
            .HasForeignKey("ActorPrincipalId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetConnectionRow>().HasOne<FleetCredentialRow>().WithMany()
            .HasForeignKey("CredentialId", "FleetId")
            .HasPrincipalKey("Id", "FleetId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetConnectionRow>().HasOne<FleetRow>().WithMany()
            .HasForeignKey("FleetId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.Cascade);
        model.Entity<FleetMessageRow>().HasOne<FleetCredentialRow>().WithMany()
            .HasForeignKey("AuthorCredentialId", "FleetId")
            .HasPrincipalKey("Id", "FleetId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetMessageRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("AuthorPrincipalId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetMessageRow>().HasOne<FleetRow>().WithMany()
            .HasForeignKey("FleetId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.Cascade);
        model.Entity<FleetMessageDeliveryRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetMessageDeliveryRow>().HasOne<FleetMessageRow>().WithMany()
            .HasForeignKey("MessageId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.Cascade);
        model.Entity<WakeRuleRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("ConfiguredById")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<WakeRuleRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("OwnerId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<WakeRuleAgentRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<WakeRuleAgentRow>().HasOne<WakeRuleRow>().WithMany()
            .HasForeignKey("RuleId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.Cascade);
        model.Entity<WakeDeliveryRow>().HasOne<WakeRuleAgentRow>().WithMany()
            .HasForeignKey("RuleId", "AgentId")
            .HasPrincipalKey("RuleId", "AgentId").OnDelete(DeleteBehavior.Cascade);
        model.Entity<WakeDeliveryRow>().HasOne<ListenerRunRow>().WithMany()
            .HasForeignKey("RunId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AgentOwnerConversationRow>().HasOne<AgentRoomGrantRow>().WithMany()
            .HasForeignKey("AgentId", "RoomId")
            .HasPrincipalKey("AgentId", "RoomId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<AgentOwnerConversationRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId", "OwnerId")
            .HasPrincipalKey("PrincipalId", "OwnerId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<RuntimeDecisionRow>().HasOne<ListenerRunRow>().WithMany()
            .HasForeignKey("RunId", "AgentId")
            .HasPrincipalKey("Id", "AgentId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<RuntimeDecisionRow>().HasOne<ListenerRunRow>().WithMany()
            .HasForeignKey("RunId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<RuntimeDecisionRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<RuntimeDecisionQuestionRow>().HasOne<RuntimeDecisionRow>().WithMany()
            .HasForeignKey("DecisionId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<RuntimeDecisionOptionRow>().HasOne<RuntimeDecisionQuestionRow>().WithMany()
            .HasForeignKey("DecisionId", "QuestionId")
            .HasPrincipalKey("DecisionId", "QuestionId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<RuntimeDecisionAnswerRow>().HasOne<RuntimeDecisionOptionRow>().WithMany()
            .HasForeignKey("DecisionId", "QuestionId", "OptionId")
            .HasPrincipalKey("DecisionId", "QuestionId", "OptionId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<RuntimeDecisionAnswerRow>().HasOne<RuntimeDecisionQuestionRow>().WithMany()
            .HasForeignKey("DecisionId", "QuestionId")
            .HasPrincipalKey("DecisionId", "QuestionId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<RuntimeObservationRow>().HasOne<ListenerRunRow>().WithMany()
            .HasForeignKey("RunId", "AgentId")
            .HasPrincipalKey("Id", "AgentId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<RuntimeObservationRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<RuntimeSettingRow>().HasOne<RuntimeObservationRow>().WithMany()
            .HasForeignKey("RunId", "SessionId")
            .HasPrincipalKey("RunId", "SessionId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<RuntimeIncidentRow>().HasOne<ListenerRunRow>().WithMany()
            .HasForeignKey("RunId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<RuntimeIncidentRow>().HasOne<FleetRow>().WithMany()
            .HasForeignKey("FleetId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<RuntimeIncidentRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<RuntimeIncidentRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("OwnerId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<IncidentNotificationRow>().HasOne<RuntimeIncidentRow>().WithMany()
            .HasForeignKey("IncidentId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<ManagementConversationRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("OwnerId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<ListenerStatCheckpointRow>().HasOne<ListenerRunRow>().WithMany()
            .HasForeignKey("RunId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<ListenerStatIntervalRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<ListenerStatIntervalRow>().HasOne<ListenerRunRow>().WithMany()
            .HasForeignKey("RunId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<ListenerStatFlowRow>().HasOne<ListenerStatIntervalRow>().WithMany()
            .HasForeignKey("RunId", "BucketAt")
            .HasPrincipalKey("RunId", "BucketAt").OnDelete(DeleteBehavior.Cascade);
        model.Entity<ListenerStatUsageRow>().HasOne<ListenerStatIntervalRow>().WithMany()
            .HasForeignKey("RunId", "BucketAt")
            .HasPrincipalKey("RunId", "BucketAt").OnDelete(DeleteBehavior.Cascade);
        model.Entity<RuntimeUsageCheckpointRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<EnrollmentItemPolicyRow>().HasOne<EnrollmentItemRow>().WithMany()
            .HasForeignKey("RequestId", "InstanceKey")
            .HasPrincipalKey("RequestId", "InstanceKey").OnDelete(DeleteBehavior.Cascade);
        model.Entity<EnrollmentItemPermissionRow>().HasOne<PermissionRow>().WithMany()
            .HasForeignKey("PermissionCode", "GrantScope")
            .HasPrincipalKey("Code", "GrantScope").OnDelete(DeleteBehavior.NoAction);
        model.Entity<EnrollmentItemPermissionRow>().HasOne<EnrollmentItemPolicyRow>().WithMany()
            .HasForeignKey("RequestId", "InstanceKey")
            .HasPrincipalKey("RequestId", "InstanceKey").OnDelete(DeleteBehavior.Cascade);
        model.Entity<EnrollmentItemWakeSenderRow>().HasOne<PrincipalRow>().WithMany()
            .HasForeignKey("SenderPrincipalId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<EnrollmentItemWakeSenderRow>().HasOne<EnrollmentItemPolicyRow>().WithMany()
            .HasForeignKey("RequestId", "InstanceKey")
            .HasPrincipalKey("RequestId", "InstanceKey").OnDelete(DeleteBehavior.Cascade);
        model.Entity<FleetInstancePolicyRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("ApprovedByMemberId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetInstancePolicyRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId", "ApprovedByMemberId")
            .HasPrincipalKey("PrincipalId", "OwnerId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetInstancePolicyRow>().HasOne<FleetInstanceRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("AgentId").OnDelete(DeleteBehavior.Cascade);
        model.Entity<FleetInstancePermissionRow>().HasOne<PermissionRow>().WithMany()
            .HasForeignKey("PermissionCode", "GrantScope")
            .HasPrincipalKey("Code", "GrantScope").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetInstancePermissionRow>().HasOne<FleetInstancePolicyRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("AgentId").OnDelete(DeleteBehavior.Cascade);
        model.Entity<FleetRuntimeOperationRow>().HasOne<FleetCredentialRow>().WithMany()
            .HasForeignKey("CredentialId", "FleetId")
            .HasPrincipalKey("Id", "FleetId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetRuntimeOperationRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("AuthorPrincipalId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetRuntimeOperationRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetRuntimeOperationRow>().HasOne<FleetRow>().WithMany()
            .HasForeignKey("FleetId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.Cascade);
        model.Entity<PublicationRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<PublicationFileRow>().HasOne<PublicationRow>().WithMany()
            .HasForeignKey("PublicationId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.Cascade);
        model.Entity<EnrollmentArchiveRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("DecidedByMemberId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<EnrollmentArchiveRow>().HasOne<MemberRow>().WithMany()
            .HasForeignKey("OwnerId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<EnrollmentArchiveItemRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<EnrollmentArchiveItemRow>().HasOne<EnrollmentArchiveRow>().WithMany()
            .HasForeignKey("RequestId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<EnrollmentArchivePolicyRow>().HasOne<EnrollmentArchiveItemRow>().WithMany()
            .HasForeignKey("RequestId", "InstanceKey")
            .HasPrincipalKey("RequestId", "InstanceKey").OnDelete(DeleteBehavior.NoAction);
        model.Entity<EnrollmentArchivePermissionRow>().HasOne<PermissionRow>().WithMany()
            .HasForeignKey("PermissionCode", "GrantScope")
            .HasPrincipalKey("Code", "GrantScope").OnDelete(DeleteBehavior.NoAction);
        model.Entity<EnrollmentArchivePermissionRow>().HasOne<EnrollmentArchivePolicyRow>().WithMany()
            .HasForeignKey("RequestId", "InstanceKey")
            .HasPrincipalKey("RequestId", "InstanceKey").OnDelete(DeleteBehavior.NoAction);
        model.Entity<EnrollmentArchiveWakeSenderRow>().HasOne<EnrollmentArchivePolicyRow>().WithMany()
            .HasForeignKey("RequestId", "InstanceKey")
            .HasPrincipalKey("RequestId", "InstanceKey").OnDelete(DeleteBehavior.NoAction);
        model.Entity<EnrollmentArchiveWakeSenderRow>().HasOne<PrincipalRow>().WithMany()
            .HasForeignKey("SenderPrincipalId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<EnrollmentArchiveMetadataRow>().HasOne<EnrollmentArchiveRow>().WithMany()
            .HasForeignKey("EnrollmentId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetNativeStopRow>().HasOne<FleetCredentialRow>().WithMany()
            .HasForeignKey("CredentialId", "FleetId")
            .HasPrincipalKey("Id", "FleetId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetNativeStopRow>().HasOne<ListenerRunRow>().WithMany()
            .HasForeignKey("RunId", "AgentId")
            .HasPrincipalKey("Id", "AgentId").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetNativeStopRow>().HasOne<FleetRow>().WithMany()
            .HasForeignKey("FleetId")
            .HasPrincipalKey("Id").OnDelete(DeleteBehavior.NoAction);
        model.Entity<FleetNativeStopRow>().HasOne<AgentRow>().WithMany()
            .HasForeignKey("AgentId")
            .HasPrincipalKey("PrincipalId").OnDelete(DeleteBehavior.NoAction);
    }
}
