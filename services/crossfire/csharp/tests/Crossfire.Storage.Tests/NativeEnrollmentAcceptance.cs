using Crossfire.AdapterMatrix;
using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class NativeEnrollmentAcceptance
{
    public static async Task Verify(AccountAuthority authority, string database, string ownerBackendUserId, string serverName)
    {
        using var context = new CrossfireDbContext(DatabaseConnections.Options(database));
        Equal(Schema.Validate(context).IsSuccess, true, "native enrollment uses the real Knex management schema");
        Equal(PrincipalValues.Initialize(PolicyQueries.Ports(context, Identity.Now), ownerBackendUserId, authority.Ports().LocalLabel(ownerBackendUserId)).IsSuccess, true, "native owner registration");
        var owner = MemberQueries.ByBackendUserId(context, ownerBackendUserId).Value!;
        var actor = new Actor(owner.Id, "human", new NativeAuthentication(owner.BackendUserId));
        var ports = EnrollmentCommands.Ports(context, Identity.Now, authority.Ports());
        var roster = new EnrollmentRoster(ownerBackendUserId, "native-enrollment", new("Native controller", new Dictionary<string, string>()),
            [new("specialist", "native-enrolled-specialist", null, new("selected", [new(ownerBackendUserId, true)], ["room.agent.invite"]))]);
        var input = new EnrollmentIntroduction(Identity.Identifier(), Identity.Secret(), roster);
        var introduced = await EnrollmentRequests.Introduce(ports, input);
        Equal(introduced.IsSuccess, true, "native enrollment introduction");
        Equal(EnrollmentDecisions.Decide(ports, actor, input.EnrollmentId, new(0, "approve", introduced.Value.Request.VerificationCode), Identity.Identifier()).IsSuccess,
            true, "native exact owner-reviewed roster approval");
        var agentId = EnrollmentQueries.Items(context, input.EnrollmentId).Value.Single().AgentId!;
        var applications = PrincipalApplicationCommands.Ports(context, Identity.Now, authority.Ports(), authority.RoomOperation);
        Equal((await PrincipalApplications.Reconcile(applications, agentId)).IsSuccess, true, "native principal provisioning and observation persist");
        var first = PrincipalApplicationCommands.Find(context, agentId).Value!;
        Equal(first.ErrorCode is null, true, "native principal reconciliation succeeds" + (first.ErrorMessage is null ? "" : ": " + first.ErrorMessage));
        Equal(first.AppliedStatus, "active", "native principal status is observed, not assumed from approval");
        var exchanged = EnrollmentClaims.Exchange(ports, input.EnrollmentId, input.ClaimSecret).Value;
        Equal(exchanged.Status, "ready", "real provisioned native account can be exchanged");
        var account = exchanged.Instances.Single().Account!;
        Equal((await authority.Identify(account.AccessToken)).Value, account.UserId, "exchanged native credential identifies the exact enrolled agent");
        var saved = roster with { ControllerCredential = exchanged.Fleet!.ControllerCredential,
            Instances = [roster.Instances[0] with { AgentId = agentId, AccessToken = account.AccessToken }] };
        Equal((await EnrollmentRequests.Introduce(ports, new(Identity.Identifier(), Identity.Secret(), saved))).Value.Request.Status, "approved",
            "real native credential proof allows unchanged roster reconnect");
        var conversations = OwnerConversationCommands.Ports(context, Identity.Now, authority.Ports(), authority.RoomOperation);
        var room = await OwnerConversations.Ensure(conversations, agentId);
        Equal(room.IsSuccess, true, "domain owner conversation integration" + (room.IsSuccess ? "" : ": " + room.Error.Message));
        Equal((await OwnerConversations.Ensure(conversations, agentId)).Value, room.Value, "repeat domain owner conversation preserves exact room");
        Equal(RoomGrantQueries.Private(context, room.Value).Value!.AgentId, agentId, "native DM is bound to exact private agent identity");
        Equal(RoomGrantQueries.Permissions(context, agentId, room.Value).Value.Count, 0, "private DM never inherits fleet invitation delegation");
        Equal((await authority.Leave(account.UserId, room.Value)).IsSuccess, true, "native domain DM repair fixture departure");
        Equal((await OwnerConversations.Ensure(conversations, agentId)).Value, room.Value, "domain DM repair preserves saved conversation");
        Equal((await authority.Membership(ownerBackendUserId, account.UserId, room.Value)).Value.Membership, "join", "domain DM repair confirms actual native membership");
        Equal(Transactions.Run(context, () =>
        {
            context.Principal.Single(row => row.Id == agentId).Status = "suspended";
            context.Principal.Single(row => row.Id == agentId).Revision++;
            return Results.Done();
        }).IsSuccess, true, "native suspended principal fixture");
        Equal((await PrincipalApplications.Reconcile(applications, agentId)).IsSuccess, true, "native suspension reconciliation");
        Equal(PrincipalApplicationCommands.Find(context, agentId).Value!.AppliedStatus, "suspended", "suspended intent observed in native application");
        Equal((await authority.Joined(account.UserId)).Value.Count, 0, "suspended native account leaves every joined room");
        Equal((await OwnerConversations.Ensure(conversations, agentId)).Error.Code, "forbidden", "suspended agent cannot restore owner DM membership");
        Equal(Transactions.Run(context, () =>
        {
            context.Principal.Single(row => row.Id == agentId).Status = "revoked";
            context.Principal.Single(row => row.Id == agentId).Revision++;
            return Results.Done();
        }).IsSuccess, true, "native revoked principal fixture");
        Equal((await PrincipalApplications.Reconcile(applications, agentId)).IsSuccess, true, "native revocation reconciliation");
        Equal(PrincipalApplicationCommands.Find(context, agentId).Value!.AppliedStatus, "revoked", "native revocation is persisted after successful native operation");
        Equal(EnrollmentQueries.Credential(context, agentId).Value!.AccessToken is null, true, "revoked native token removed from private management store");
        Equal((await authority.Identify(account.AccessToken)).IsSuccess, false, "revoked actual native credential no longer authenticates");
    }
}
