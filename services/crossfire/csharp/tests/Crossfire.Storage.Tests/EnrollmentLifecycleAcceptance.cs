using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class EnrollmentLifecycleAcceptance
{
    public static async Task Verify(CrossfireDbContext context, Actor owner, Actor other, long start)
    {
        var now = start;
        var identity = ((NativeAuthentication)owner.Authentication!).BackendUserId;
        var policy = new CoordinationPolicy("selected", [new(identity, true)], ["room.agent.invite"]);
        var nativeCalls = 0;
        var messaging = MessagingFixture.Ports() with { AgentUserId = id => "@agent-" + id + ":example.test", Identify = (token, cancellation) =>
        {
            Equal(context.Database.CurrentTransaction is null, true, "enrollment native proof occurs before transaction");
            nativeCalls++;
            var separator = token.IndexOf('|');
            return ValueTask.FromResult(separator < 0 ? Results.Fail<string>("unauthorized", "Invalid credential") : Result<string>.Success(token[(separator + 1)..]));
        }, Room = (user, room, subject, cancellation) => ValueTask.FromResult(Results.Fail<RoomFacts>("missing", "No room in enrollment fixture")) };
        var ports = EnrollmentCommands.Ports(context, () => now, messaging);
        var name = "specialist-" + Identity.Identifier()[..8];
        var roster = new EnrollmentRoster(identity, "fleet-" + Identity.Identifier()[..8], new("Native enrollment", new Dictionary<string, string> { ["host"] = "test" }),
            [new("specialist", name, null, policy)]);
        var introduction = new EnrollmentIntroduction(Identity.Identifier(), Identity.Secret(), roster);
        var created = await EnrollmentRequests.Introduce(ports, introduction);
        Equal(created.IsSuccess, true, "introduction persists complete requested enrollment");
        Equal(created.Value.Request.Status, "pending", "new identities require owner review");
        Equal(created.Value.Instances.Single().CoordinationPolicy.Senders.Single().IncludeAgents, true, "review preserves owner-plus-agents selection");
        Equal(created.Value.Instances.Single().Item.AgentId is null, true, "no identity is created before owner approval");
        Equal((await EnrollmentRequests.Introduce(ports, introduction)).Value.Request.Id, introduction.EnrollmentId, "request retry preserves exact enrollment identity");
        Equal((await EnrollmentRequests.Introduce(ports, introduction with { ClaimSecret = Identity.Secret() })).Error.Code, "conflict", "request retry cannot substitute private claim");
        Equal((await EnrollmentRequests.Introduce(ports, introduction with { Roster = roster with { Controller = new("Different controller", new Dictionary<string, string>()) } })).Error.Code,
            "conflict", "request retry cannot substitute reviewed descriptor");
        var collided = await EnrollmentRequests.Introduce(ports, introduction with { EnrollmentId = Identity.Identifier(), ClaimSecret = Identity.Secret(), Roster = roster with { FleetKey = "other-fleet" } });
        Equal(collided.Error.Code, "name_collision", "pending global reservation prevents parallel fleet collision");
        Equal(EnrollmentRequests.Read(ports, other, introduction.EnrollmentId).IsSuccess, true, "administrator can inspect pending owner request");
        var decision = new EnrollmentDecision(0, "approve", created.Value.Request.VerificationCode);
        Equal(EnrollmentDecisions.Decide(ports, other, introduction.EnrollmentId, decision, Identity.Identifier()).Error.Code, "forbidden", "administrator cannot approve on owner's behalf");
        Equal(EnrollmentDecisions.Decide(ports, owner, introduction.EnrollmentId, decision with { VerificationCode = "WRONG" }, Identity.Identifier()).Error.Code,
            "conflict", "exact verification code is required");
        Equal(EnrollmentClaims.Exchange(ports, introduction.EnrollmentId, "wrong-claim").Error.Code, "unauthorized", "private enrollment exchange requires original claim");
        Equal(EnrollmentClaims.Exchange(ports, introduction.EnrollmentId, introduction.ClaimSecret).Value.Status, "pending", "pending exchange returns no native credential");
        var denied = ports with { Admission = ports.Admission with { Fleet = ports.Admission.Fleet with { Audit = _ => Results.Fail<Unit>("unavailable", "Injected audit failure") } } };
        Equal(EnrollmentDecisions.Decide(denied, owner, introduction.EnrollmentId, decision, Identity.Identifier()).Error.Code, "unavailable", "enrollment audit failure propagates");
        Equal(EnrollmentQueries.Find(context, introduction.EnrollmentId).Value!.Status, "pending", "failed approval rolls back request");
        Equal(EnrollmentQueries.Items(context, introduction.EnrollmentId).Value.Single().AgentId is null, true, "failed approval rolls back new identity");
        Equal(EnrollmentAdmissionQueries.Fleet(context, owner.PrincipalId, roster.FleetKey).Value is null, true, "failed approval rolls back fleet and controller credential");
        Equal(EnrollmentDecisions.Decide(ports, owner, introduction.EnrollmentId, decision, Identity.Identifier()).Value.Status, "approved", "owner approves whole exact roster atomically");
        Equal(EnrollmentDecisions.Decide(ports, owner, introduction.EnrollmentId, decision, Identity.Identifier()).Error.Code, "conflict", "review cannot be applied twice");
        var item = EnrollmentQueries.Items(context, introduction.EnrollmentId).Value.Single();
        var agentId = item.AgentId!;
        var agent = AuthorizationQueries.AgentView(context, agentId).Value!;
        Equal(agent.Principal.BackendUserId, "@agent-" + agentId + ":example.test", "approved native identity uses stable agent UUID");
        Equal(agent.Name, name, "reserved name belongs to approved stable identity");
        Equal(WakeCommands.Senders(context, agentId).Value.Single().SenderPrincipalId, owner.PrincipalId, "approval installs reviewed wake selection");
        Equal(RoomGrantQueries.FleetPolicy(context, agentId).Value!.Permissions.Single(), "room.agent.invite", "approval installs reviewed invitation permission");
        Equal(EnrollmentClaims.Exchange(ports, introduction.EnrollmentId, introduction.ClaimSecret).Value.Status, "provisioning", "approval is distinct from native provisioning");
        var nativeToken = "token|" + agent.Principal.BackendUserId;
        Equal(Transactions.Run(context, () =>
        {
            context.AgentCredential.Single(row => row.AgentId == agentId).AccessToken = nativeToken;
            var application = context.PrincipalApplication.Single(row => row.PrincipalId == agentId);
            application.AppliedStatus = "active"; application.NativeDisplayName = agent.Name + " (" + agent.OwnerMember.DisplayName + ")";
            return Results.Done();
        }).IsSuccess, true, "exact ready native-account observation fixture");
        var exchanged = EnrollmentClaims.Exchange(ports, introduction.EnrollmentId, introduction.ClaimSecret).Value;
        Equal(exchanged.Status, "ready", "ready exchange requires applied meaningful display name");
        Equal(exchanged.Instances.Single().Account!.AccessToken, nativeToken, "ready exchange returns preserved private token");
        var controller = exchanged.Fleet!.ControllerCredential!;
        Equal(FleetAuthority.Authenticate(ports.Admission.Fleet, controller).Value.FleetId, exchanged.Fleet.FleetId, "exchange controller credential authenticates exact fleet");
        var existing = roster with { ControllerCredential = controller, Instances = [new("specialist", name, agentId, policy, nativeToken)] };
        var repeated = new EnrollmentIntroduction(Identity.Identifier(), Identity.Secret(), existing);
        Equal((await EnrollmentRequests.Introduce(ports, repeated)).Value.Request.Status, "approved", "unchanged verified roster does not require another human approval");
        Equal(EnrollmentClaims.Exchange(ports, repeated.EnrollmentId, repeated.ClaimSecret).Value.Fleet!.ControllerCredential is null, true,
            "unchanged roster does not issue a replacement controller credential");
        var renamedName = "renamed-" + Identity.Identifier()[..8];
        var rename = repeated with { EnrollmentId = Identity.Identifier(), ClaimSecret = Identity.Secret(), Roster = existing with { Instances = [existing.Instances[0] with { Name = renamedName }] } };
        var renameReview = await EnrollmentRequests.Introduce(ports, rename);
        Equal(renameReview.Value.Request.Status, "pending", "name change requires explicit owner review");
        Equal(renameReview.Value.Instances.Single().CurrentName, name, "rename review shows existing name separately");
        var staleDecision = new EnrollmentDecision(0, "approve", renameReview.Value.Request.VerificationCode);
        Equal(Transactions.Run(context, () => { var row = context.Principal.Single(row => row.Id == agentId); row.Revision++; return Results.Done(); }).IsSuccess, true, "concurrent agent configuration change");
        Equal(EnrollmentDecisions.Decide(ports, owner, rename.EnrollmentId, staleDecision, Identity.Identifier()).Error.Code, "conflict", "stale reviewed agent revision cannot rename");
        Equal(AuthorizationQueries.AgentView(context, agentId).Value!.Name, name, "stale approval preserves original name");
        Equal(EnrollmentDecisions.Decide(ports, owner, rename.EnrollmentId, staleDecision with { Decision = "reject" }, Identity.Identifier()).Value.Status,
            "rejected", "owner rejection releases requested names");
        Equal(EnrollmentAdmissionQueries.Name(context, renamedName).Value is null, true, "rejected reservation is reusable");
        var freshRename = rename with { EnrollmentId = Identity.Identifier(), ClaimSecret = Identity.Secret() };
        var reviewed = await EnrollmentRequests.Introduce(ports, freshRename);
        Equal(EnrollmentDecisions.Decide(ports, owner, freshRename.EnrollmentId, new(0, "approve", reviewed.Value.Request.VerificationCode), Identity.Identifier()).IsSuccess,
            true, "fresh reviewed rename is applied");
        Equal(AuthorizationQueries.AgentView(context, agentId).Value!.Name, renamedName, "rename preserves identity while replacing name");
        Equal(EnrollmentAdmissionQueries.Name(context, name).Value is null, true, "superseded registered name is removed");
        Equal(EnrollmentClaims.Exchange(ports, introduction.EnrollmentId, introduction.ClaimSecret).Error.Code, "conflict", "old enrollment cannot exchange a renamed roster");
        var expiredName = "expiring-" + Identity.Identifier()[..8];
        var expiring = introduction with { EnrollmentId = Identity.Identifier(), ClaimSecret = Identity.Secret(),
            Roster = roster with { FleetKey = "expiring-" + Identity.Identifier()[..8], Instances = [new("expiry", expiredName, null, policy)] } };
        Equal((await EnrollmentRequests.Introduce(ports, expiring)).Value.Request.Status, "pending", "expiry fixture enrollment");
        now += PolicyQueries.Find(context).Value!.EnrollmentSeconds * 1000 + 1;
        Equal(EnrollmentClaims.Exchange(ports, expiring.EnrollmentId, expiring.ClaimSecret).Value.Status, "expired", "expired pending exchange never releases secrets");
        Equal(EnrollmentClaims.Exchange(ports, freshRename.EnrollmentId, freshRename.ClaimSecret).Value.Status, "expired", "approved enrollment claim also expires without releasing credentials");
        Equal(EnrollmentClaims.Exchange(ports, expiring.EnrollmentId, expiring.ClaimSecret).Value.OwnerBackendUserId, identity, "expired exchange preserves the authenticated claim owner representation");
        Equal(Transactions.Run(context, () => EnrollmentRequests.Expire(ports)).IsSuccess, true, "pending expiry is transactional");
        Equal(EnrollmentQueries.Find(context, expiring.EnrollmentId).Value!.Status, "expired", "expiry stored as canonical state");
        Equal(EnrollmentAdmissionQueries.Name(context, expiredName).Value is null, true, "expiry releases name reservation");
        Equal(EnrollmentQueries.List(context, owner.PrincipalId, 1, 10).Value.TotalItems >= 4, true, "normalized paginated enrollment listing");
        Equal(nativeCalls >= 3, true, "saved rosters prove native identity before admission");
    }
}
