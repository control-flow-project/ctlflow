using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class EnrollmentAcceptance
{
    public static async Task Verify(CrossfireDbContext context, Actor owner, long now)
    {
        var fixture = FleetFixture.Create(context, owner, now);
        var credential = FleetAuthority.ControllerToken(fixture.CredentialId, Identity.Secret());
        var agent = AuthorizationQueries.AgentView(context, fixture.AgentId).Value!;
        Equal(Transactions.Run(context, () =>
        {
            var id = fixture.CredentialId;
            context.FleetCredential.Single(row => row.Id == id).SecretHash = Identity.Hash(credential);
            context.AgentCredential.Add(new() { AgentId = fixture.AgentId, AccessToken = "saved-agent-token", ProvisioningPassword = "private-password", UpdatedAt = now });
            return Results.Done();
        }).IsSuccess, true, "saved enrollment identity fixture");
        var calls = 0;
        var ports = EnrollmentAdmissionQueries.Ports(context, () => now, (token, cancellation) =>
        {
            Equal(context.Database.CurrentTransaction is null, true, "native enrollment identity proof outside transaction");
            calls++;
            return ValueTask.FromResult(token == "saved-agent-token" ? Result<string>.Success(agent.Principal.MatrixUserId) : Results.Fail<string>("unauthorized", "Invalid native identity"));
        });
        var policy = new CoordinationPolicy("selected", [new(((NativeAuthentication)owner.Authentication!).MatrixUserId, true)], ["room.agent.invite"]);
        var instance = new RosterInstance("test-agent", agent.Name, fixture.AgentId, policy, "saved-agent-token");
        var roster = new EnrollmentRoster(((NativeAuthentication)owner.Authentication!).MatrixUserId, fixture.FleetKey, new("Native test", new Dictionary<string, string>()), [instance], credential);
        Equal((await EnrollmentAdmission.Preflight(ports, roster)).Value, 1, "matching saved roster preflight");
        Equal(calls, 1, "live identity proof uses native authority");
        var collision = roster with { FleetKey = "new-enrollment", ControllerCredential = null, Instances = [instance with { AgentId = null, AccessToken = null }] };
        var collided = await EnrollmentAdmission.Preflight(ports, collision);
        Equal(collided.Error.Code, "name_collision", "globally claimed agent name prevents deployment");
        Equal(collided.Error.Message, "Name collision: " + agent.Name, "collision reports the actual conflicting name");
        Equal((await EnrollmentAdmission.Preflight(ports, roster with { Instances = [instance, instance] })).Error.Code, "invalid", "duplicate instance keys and names rejected before native work");
        Equal((await EnrollmentAdmission.Preflight(ports, roster with { Instances = [instance with { AgentId = null, AccessToken = null }] })).Error.Code, "conflict", "saved instance cannot silently acquire another identity");
        Equal((await EnrollmentAdmission.Preflight(ports, roster with { ControllerCredential = null })).Error.Code, "unauthorized", "current fleet requires private controller credential");
        Equal((await EnrollmentAdmission.Preflight(ports, collision with { ControllerCredential = credential })).Error.Code, "invalid", "controller credential cannot attach to an unrelated new fleet");
        Equal((await EnrollmentAdmission.Preflight(ports, roster with { Instances = [instance with { AccessToken = "wrong-token" }] })).Error.Code, "unauthorized", "saved agent identity proof must be current native token");
        var verified = await EnrollmentAdmission.Verify(ports, roster);
        Equal(verified.Value.Policies[0].Policy.Senders[0].PrincipalId, owner.PrincipalId, "reviewed Matrix sender resolves to canonical principal");
        Equal(verified.Value.Policies[0].Policy.Senders[0].IncludeAgents, true, "owner and owner's agents remain one explicit selection");
        Equal(verified.Value.Policies[0].Policy.ExpectedAgentRevision, agent.Principal.Revision, "review binds existing identity revision");
        var count = EnrollmentAdmissionQueries.ActiveAgents(context, null).Value;
        var currentPolicy = PolicyQueries.Find(context).Value!;
        var bounded = ports with { Policy = () => Result<InstancePolicy?>.Success(currentPolicy with { MaxAgents = count }) };
        var additional = collision with { Instances = [instance with { Name = "unique-" + Identity.Identifier()[..8], AgentId = null, AccessToken = null }] };
        Equal((await EnrollmentAdmission.Preflight(bounded, additional)).Error.Code, "capacity", "new identities respect current instance capacity");
        Equal(Transactions.Run(context, () =>
        {
            var id = fixture.AgentId;
            context.FleetInstance.Single(row => row.AgentId == id).RetiredAt = now;
            context.Principal.Single(row => row.Id == id).Status = "suspended";
            return Results.Done();
        }).IsSuccess, true, "explicitly retired enrollment fixture");
        var previousCalls = calls;
        Equal((await EnrollmentAdmission.Preflight(ports, roster)).Value, 1, "retired identity can be reviewed with preserved private credentials");
        Equal(calls, previousCalls, "retirement review never logs in to deactivated native identity");
        Equal((await EnrollmentAdmission.Preflight(ports, roster with { Instances = [instance with { AccessToken = "wrong-token" }] })).Error.Code,
            "forbidden", "retirement is not permission to replace private identity proof");
        Equal(IdentitySyntax.MatrixUser("@name\u0085:example.test"), true, "identity syntax does not add non-ECMAScript whitespace restrictions");
        Equal(IdentitySyntax.MatrixUser("@name\ufeff:example.test"), false, "identity syntax excludes ECMAScript BOM whitespace");
    }
}
