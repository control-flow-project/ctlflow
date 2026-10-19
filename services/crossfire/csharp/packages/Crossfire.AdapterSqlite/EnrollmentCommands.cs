using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class EnrollmentCommands
{
    public static Result<Unit> Save(CrossfireDbContext context, EnrollmentRequest value, bool create)
    {
        var id = value.Id;
        var row = create ? new Entities.EnrollmentRequestRow { Id = id } : context.EnrollmentRequest.Single(row => row.Id == id);
        if (create) context.EnrollmentRequest.Add(row);
        row.OwnerId = value.OwnerId; row.FleetKey = value.FleetKey; row.ControllerName = value.ControllerName; row.ControllerCredentialHash = value.ControllerCredentialHash;
        row.VerificationCode = value.VerificationCode; row.ClaimHash = value.ClaimHash; row.RosterDigest = value.RosterDigest; row.Status = value.Status;
        row.Revision = value.Revision; row.CreatedAt = value.CreatedAt; row.ExpiresAt = value.ExpiresAt; row.DecidedByMemberId = value.DecidedByMemberId; row.DecidedAt = value.DecidedAt;
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Item(CrossfireDbContext context, EnrollmentItem value, bool create)
    {
        var requestId = value.RequestId; var key = value.InstanceKey;
        var row = create ? new Entities.EnrollmentItemRow { RequestId = requestId, InstanceKey = key }
            : context.EnrollmentItem.Single(row => row.RequestId == requestId && row.InstanceKey == key);
        if (create) context.EnrollmentItem.Add(row);
        row.RequestedName = value.RequestedName; row.Outcome = value.Outcome; row.AgentId = value.AgentId;
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Policy(CrossfireDbContext context, EnrollmentItem item, RequestedFleetPolicy policy)
    {
        context.EnrollmentItemPolicy.Add(new() { RequestId = item.RequestId, InstanceKey = item.InstanceKey, WakeMode = policy.WakeMode, ExpectedAgentRevision = policy.ExpectedAgentRevision });
        foreach (var sender in policy.Senders) context.EnrollmentItemWakeSender.Add(new() { RequestId = item.RequestId, InstanceKey = item.InstanceKey,
            SenderPrincipalId = sender.PrincipalId, IncludeAgents = sender.IncludeAgents ? 1 : 0 });
        foreach (var code in policy.Permissions) context.EnrollmentItemPermission.Add(new() { RequestId = item.RequestId, InstanceKey = item.InstanceKey,
            PermissionCode = code, GrantScope = "agent_room" });
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Metadata(CrossfireDbContext context, string enrollmentId, IReadOnlyDictionary<string, string> values)
    {
        foreach (var entry in values) context.EnrollmentControllerMetadata.Add(new() { EnrollmentId = enrollmentId, Key = entry.Key, Value = entry.Value });
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Name(CrossfireDbContext context, AgentName value, bool create)
    {
        var name = value.Name;
        var row = create ? new Entities.AgentNameRow { Name = name } : context.AgentName.Single(row => row.Name == name);
        if (create) context.AgentName.Add(row);
        row.RequestId = value.RequestId; row.InstanceKey = value.InstanceKey; row.AgentId = value.AgentId;
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> RemoveName(CrossfireDbContext context, string name)
    {
        context.AgentName.RemoveRange(context.AgentName.Where(row => row.Name == name).ToArray());
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> ReleaseNames(CrossfireDbContext context, string requestId)
    {
        context.AgentName.RemoveRange(context.AgentName.Where(row => row.RequestId == requestId).ToArray());
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> RegisterAgent(CrossfireDbContext context, Agent agent, AgentCredential credential)
    {
        context.Agent.Add(new() { PrincipalId = agent.PrincipalId, PrincipalKind = agent.PrincipalKind, OwnerId = agent.OwnerId, WakeMode = agent.WakeMode });
        context.AgentCredential.Add(new() { AgentId = credential.AgentId, ProvisioningPassword = credential.ProvisioningPassword, AccessToken = credential.AccessToken, UpdatedAt = credential.UpdatedAt });
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Principal(CrossfireDbContext context, Principal value, long nextCheckAt)
    {
        var id = value.Id;
        var row = context.Principal.Single(row => row.Id == id);
        row.Status = value.Status; row.Revision = value.Revision;
        context.PrincipalApplication.Single(row => row.PrincipalId == id).NextCheckAt = nextCheckAt;
        context.SaveChanges(); return Results.Done();
    }

    public static EnrollmentPorts Ports(CrossfireDbContext context, Func<long> now, MessagingPorts messaging)
        => new(EnrollmentAdmissionQueries.Ports(context, now, messaging.Identify), new SqliteUnitOfWork(context), RoomGrantCommands.Ports(context, now, messaging), WakeCommands.Ports(context, now),
            id => EnrollmentQueries.Find(context, id), id => EnrollmentQueries.Items(context, id), id => EnrollmentQueries.Policies(context, id),
            timestamp => EnrollmentQueries.Expired(context, timestamp), () => EnrollmentQueries.PendingCount(context), (value, create) => Save(context, value, create),
            (value, create) => Item(context, value, create), (item, policy) => Policy(context, item, policy), (id, values) => Metadata(context, id, values),
            id => EnrollmentQueries.Metadata(context, id), (value, create) => Name(context, value, create), name => RemoveName(context, name), id => ReleaseNames(context, id),
            (principal, role, assignedBy) => MemberCommands.RegisterIdentity(context, principal, new(principal.Id, principal.Kind, role, assignedBy, now()), PrincipalValues.Pending(principal.Id, now())),
            (agent, credential) => RegisterAgent(context, agent, credential), (principal, timestamp) => Principal(context, principal, timestamp),
            id => EnrollmentQueries.Credential(context, id), (fleet, create) => EnrollmentFleetCommands.Fleet(context, fleet, create),
            (binding, create) => EnrollmentFleetCommands.Binding(context, binding, create), credential => EnrollmentFleetCommands.Credential(context, credential),
            (id, values) => EnrollmentFleetCommands.Metadata(context, id, values), (id, policy) => EnrollmentFleetCommands.Policy(context, id, policy, now()),
            id => WakeCommands.Senders(context, id), messaging);
}
