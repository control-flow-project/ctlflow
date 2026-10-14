using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class DomainAcceptance
{
    public static async Task Verify(CrossfireDbContext context, string ownerId, string matrixId)
    {
        var now = 1700000000000L;
        var principals = PolicyQueries.Ports(context, () => now);
        Equal(PrincipalValues.Initialize(principals, "@administrator:example.test").IsSuccess, true, "first-party initialization");
        var administrator = MemberQueries.ByMatrixId(context, "@administrator:example.test").Value!;
        Equal(PolicyQueries.Find(context).Value?.FleetIdleTimeoutSeconds, 1800L, "canonical fleet sleep default");
        Equal(PrincipalValues.Initialize(principals, administrator.MatrixUserId).IsSuccess, true, "repeatable initialization");
        var ports = MemberCommands.Ports(context, () => now);
        var admin = new Actor(administrator.Id, "human", new NativeAuthentication(administrator.MatrixUserId));
        var owner = new Actor(ownerId, "human", new NativeAuthentication(matrixId));
        Equal(Members.List(ports, admin, 1, 10).Value.TotalItems >= 2, true, "administrator member listing");
        Equal(Members.Read(ports, owner, administrator.Id).Error.Code, "forbidden", "private membership authorization");
        var renamed = Members.Change(ports, owner, ownerId, new(0, DisplayName: "Native renamed owner"), Identity.Identifier());
        Equal(renamed.IsSuccess, true, "native human self rename");
        Equal(renamed.Value.Principal.Revision, 1L, "atomic member revision");
        Equal(MemberQueries.Find(context, ownerId).Value?.Member.DisplayName, "Native renamed owner", "EF member command persistence");
        Equal(Members.Change(ports, owner, ownerId, new(0, DisplayName: "Stale rename"), Identity.Identifier()).Error.Message, "Member revision changed", "stale revision rejection");
        Equal(Members.Change(ports, admin, administrator.Id, new(0, Status: "suspended"), Identity.Identifier()).Error.Message,
            "At least one active administrator is required", "last administrator protection");
        Equal(MemberQueries.Find(context, administrator.Id).Value?.Principal.Revision, 0L, "member failure rollback");
        var sessions = SessionCommands.Ports(context, () => now, (token, cancellation) =>
            ValueTask.FromResult(token == "native-owner-token" ? Result<string>.Success(matrixId) : Results.Fail<string>("unauthorized", "Invalid native identity")));
        var first = await Sessions.Create(sessions, "native-owner-token");
        Equal(first.IsSuccess, true, "management session creation");
        Equal((await Sessions.Authenticate(sessions, first.Value.Secret, first.Value.CsrfSecret)).IsSuccess, true, "session identity and CSRF");
        Equal((await Sessions.Authenticate(sessions, first.Value.Secret, "wrong-csrf")).Error.Code, "forbidden", "CSRF rejection");
        for (var index = 1; index < 10; index++) Equal((await Sessions.Create(sessions, "native-owner-token")).IsSuccess, true, "management session " + index);
        Equal((await Sessions.Create(sessions, "native-owner-token")).Error.Code, "limit", "concurrent session limit");
        Equal(Sessions.End(sessions, first.Value.Secret).IsSuccess, true, "session termination");
        Equal((await Sessions.Authenticate(sessions, first.Value.Secret)).Error.Code, "unauthorized", "terminated credential rejection");
        now += 28800001;
        Equal((await Sessions.Create(sessions, "native-owner-token")).IsSuccess, true, "expired session replacement");
        Equal(SessionCommands.Count(context, ownerId, now).Value, 1L, "expired session retention");
        AgentAcceptance.Verify(context, owner, admin, () => now);
        DecisionAcceptance.Verify(context, owner, admin, now);
        FleetAcceptance.Verify(context, owner, admin, now);
        await RoomGrantAcceptance.Verify(context, owner, admin, now);
        await ReconciliationAcceptance.Verify(context, owner, now);
        await EnrollmentAcceptance.Verify(context, admin, now);
        await EnrollmentLifecycleAcceptance.Verify(context, owner, admin, now);
        RuntimeLifecycleAcceptance.Verify(context, owner, now);
        StatisticsAcceptance.Verify(context, owner, now);
        DirectoryAcceptance.Verify(context, owner, admin, now);
        WakeAcceptance.Verify(context, owner, admin, now);
        await PublicationAcceptance.Verify(context, owner, admin, now);
        await AuthenticationAcceptance.Verify(context, owner, admin, now);
        var policyPorts = PolicyCommands.Ports(context, () => now);
        Equal(Policies.Read(policyPorts, owner).IsSuccess, true, "members can read instance policy");
        var policy = Policies.Read(policyPorts, admin).Value;
        Equal(Policies.Change(policyPorts, owner, policy, policy.Revision, Identity.Identifier()).Error.Code, "forbidden", "only administrators can configure policy");
        Equal(Policies.Change(policyPorts, admin, policy with { MaxMessageBytes = 131072 }, policy.Revision, Identity.Identifier()).Value, policy.Revision + 1, "instance policy revision");
        Equal(Policies.Read(policyPorts, admin).Value.MaxMessageBytes, 131072L, "configured message-file threshold");
        var invitations = InvitationCommands.Ports(context, () => now);
        var invitation = Invitations.Create(invitations, admin, "member", 600, Identity.Identifier());
        Equal(invitation.IsSuccess, true, "administrator invitation creation");
        Equal(Invitations.Verify(invitations, invitation.Value.InvitationId, invitation.Value.ClaimSecret).IsSuccess, true, "private invitation hash verification");
        Equal(Invitations.Verify(invitations, invitation.Value.InvitationId, "wrong-secret").Error.Code, "unauthorized", "invitation secret isolation");
        Equal(Invitations.Create(invitations, owner, "member", 600, Identity.Identifier()).Error.Code, "forbidden", "invitation issuer policy");
        Equal(Invitations.Revoke(invitations, admin, invitation.Value.InvitationId, Identity.Identifier()).IsSuccess, true, "invitation revocation");
        Equal(Invitations.Verify(invitations, invitation.Value.InvitationId, invitation.Value.ClaimSecret).Error.Code, "unauthorized", "revoked claim cannot be used");
        ContactAcceptance.Verify(context, owner, now);
        LoggingAcceptance.Verify(context, owner, now);
    }
}
