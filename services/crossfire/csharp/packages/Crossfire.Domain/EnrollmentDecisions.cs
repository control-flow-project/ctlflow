using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class EnrollmentDecisions
{
    public static Result<EnrollmentDecisionResult> Decide(EnrollmentPorts ports, Actor actor, string enrollmentId, EnrollmentDecision input, string requestId)
        => ports.Transaction.Run(() =>
        {
            if (input.Decision is not ("approve" or "reject") || input.ExpectedRevision < 0)
                return Results.Fail<EnrollmentDecisionResult>("invalid", "Supply an approval or rejection and the reviewed revision");
            var expired = EnrollmentRequests.Expire(ports);
            if (!expired.IsSuccess) return Result<EnrollmentDecisionResult>.Fail(expired.Error);
            var found = ports.Find(enrollmentId);
            if (!found.IsSuccess) return Result<EnrollmentDecisionResult>.Fail(found.Error);
            if (found.Value is null) return Results.Fail<EnrollmentDecisionResult>("missing", "Enrollment not found");
            var request = found.Value;
            var authority = Authorization.Require(ports.Admission.Fleet.Authorization, actor, input.Decision == "approve" ? "enrollment.approve.owned"
                : request.OwnerId == actor.PrincipalId ? "enrollment.reject.owned" : "enrollment.reject.any");
            if (!authority.IsSuccess) return Result<EnrollmentDecisionResult>.Fail(authority.Error);
            if (input.Decision == "approve" && actor.PrincipalId != request.OwnerId)
                return Results.Fail<EnrollmentDecisionResult>("forbidden", "Only the intended human owner may approve enrollment");
            if (request.Status != "pending" || request.Revision != input.ExpectedRevision || request.VerificationCode != input.VerificationCode)
                return Results.Fail<EnrollmentDecisionResult>("conflict", "Enrollment or verification code changed");
            var owner = ports.Admission.Fleet.Authorization.Principal(request.OwnerId);
            if (!owner.IsSuccess) return Result<EnrollmentDecisionResult>.Fail(owner.Error);
            if (owner.Value?.Status != "active") return Results.Fail<EnrollmentDecisionResult>("forbidden", "Owner must be active");
            var items = ports.Items(enrollmentId);
            if (!items.IsSuccess) return Result<EnrollmentDecisionResult>.Fail(items.Error);
            var applied = input.Decision == "approve" ? Approve(ports, actor, request, items.Value, requestId) : ports.ReleaseNames(enrollmentId);
            if (!applied.IsSuccess) return Result<EnrollmentDecisionResult>.Fail(applied.Error);
            var changed = request with { Status = input.Decision == "approve" ? "approved" : "rejected", Revision = checked(request.Revision + 1),
                DecidedByMemberId = actor.PrincipalId, DecidedAt = ports.Admission.Fleet.Authorization.Now() };
            var saved = ports.Save(changed, false);
            if (!saved.IsSuccess) return Result<EnrollmentDecisionResult>.Fail(saved.Error);
            return ports.Admission.Fleet.Audit(new(requestId, actor.Kind, actor.PrincipalId, request.OwnerId, "enrollment", enrollmentId, "enrollment." + input.Decision))
                .Map(_ => new EnrollmentDecisionResult(enrollmentId, changed.Status, changed.Revision));
        });

    private static Result<Unit> Approve(EnrollmentPorts ports, Actor actor, EnrollmentRequest request, IReadOnlyList<EnrollmentItem> items, string requestId)
    {
        var capacity = EnrollmentAdmission.Capacity(ports.Admission, request.OwnerId);
        if (!capacity.IsSuccess) return Result<Unit>.Fail(capacity.Error);
        if (capacity.Value.Remaining < 0) return Results.Fail<Unit>("limit", "Agent capacity changed; adjust the instance limits");
        var restorations = 0;
        foreach (var item in items.Where(value => value.Outcome == "existing" && value.AgentId is not null))
        {
            var binding = ports.Admission.Fleet.Authorization.Binding(item.AgentId!);
            if (!binding.IsSuccess) return Result<Unit>.Fail(binding.Error);
            if (binding.Value is null || binding.Value.RetiredAt is not null) restorations++;
        }
        if (restorations > capacity.Value.Remaining) return Results.Fail<Unit>("capacity", "Agent restoration exceeds the current owner or instance capacity");
        var fleet = EnrollmentFleets.Approve(ports, request);
        if (!fleet.IsSuccess) return Result<Unit>.Fail(fleet.Error);
        var restoring = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in items)
        {
            if (item.Outcome == "existing" && item.AgentId is not null)
            {
                var principal = ports.Admission.Fleet.Authorization.Principal(item.AgentId);
                if (!principal.IsSuccess) return Result<Unit>.Fail(principal.Error);
                var binding = ports.Admission.Fleet.Authorization.Binding(item.AgentId);
                if (!binding.IsSuccess) return Result<Unit>.Fail(binding.Error);
                if (principal.Value is null || principal.Value.Status == "revoked" || principal.Value.Status == "suspended" && binding.Value?.RetiredAt is null)
                    return Results.Fail<Unit>("forbidden", "Only explicitly retired identities may be restored through enrollment");
                if (principal.Value.Status == "suspended") restoring.Add(item.AgentId);
            }
            if (item.Outcome != "claimed") continue;
            var name = ports.Admission.Name(item.RequestedName);
            if (!name.IsSuccess) return Result<Unit>.Fail(name.Error);
            if (name.Value is null || name.Value.RequestId != request.Id || name.Value.InstanceKey != item.InstanceKey)
                return Results.Fail<Unit>("conflict", "Name collision: " + item.RequestedName);
            var agentId = Identity.Identifier(); var now = ports.Admission.Fleet.Authorization.Now();
            var registered = ports.Register(new(agentId, ports.Messaging.AgentUserId(agentId), "agent", "active", 0, now), "agent", request.OwnerId);
            if (!registered.IsSuccess) return registered;
            var agent = ports.RegisterAgent(new(agentId, "agent", request.OwnerId, "selected"), new(agentId, Identity.Secret(), null, now));
            if (!agent.IsSuccess) return agent;
            var claimed = ports.SaveName(new(item.RequestedName, null, null, agentId), false);
            if (!claimed.IsSuccess) return claimed;
            var assigned = ports.SaveItem(item with { AgentId = agentId }, false);
            if (!assigned.IsSuccess) return assigned;
        }
        var approved = ports.Items(request.Id);
        if (!approved.IsSuccess) return Result<Unit>.Fail(approved.Error);
        var bound = EnrollmentFleets.Bind(ports, fleet.Value, approved.Value);
        if (!bound.IsSuccess) return bound;
        var policies = ports.Policies(request.Id);
        if (!policies.IsSuccess) return Result<Unit>.Fail(policies.Error);
        foreach (var item in approved.Value)
        {
            if (item.AgentId is null) return Results.Fail<Unit>("conflict", "Approved roster identity is missing");
            var policy = policies.Value.FirstOrDefault(value => value.InstanceKey == item.InstanceKey)?.Policy;
            if (policy is null) return Results.Fail<Unit>("conflict", "Fleet coordination policy is missing; submit a new request");
            var principal = ports.Admission.Fleet.Authorization.Principal(item.AgentId);
            if (!principal.IsSuccess) return Result<Unit>.Fail(principal.Error);
            if (principal.Value is null || principal.Value.Status == "revoked") return Results.Fail<Unit>("forbidden", "Revoked agent identities cannot be restored");
            if (policy.ExpectedAgentRevision is not null && policy.ExpectedAgentRevision != principal.Value.Revision)
                return Results.Fail<Unit>("conflict", "Agent changed before enrollment approval");
            if (restoring.Contains(item.AgentId))
            {
                var restored = ports.SavePrincipal(principal.Value with { Status = "active" }, ports.Admission.Fleet.Authorization.Now());
                if (!restored.IsSuccess) return restored;
            }
            var applied = EnrollmentCoordination.Apply(ports, actor, item.AgentId, policy, requestId);
            if (!applied.IsSuccess) return applied;
            var renamed = Rename(ports, actor, item, requestId);
            if (!renamed.IsSuccess) return renamed;
            if (restoring.Contains(item.AgentId))
            {
                var current = ports.Admission.Fleet.Authorization.Principal(item.AgentId);
                if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
                if (current.Value is null) return Results.Fail<Unit>("missing", "Restored identity is missing");
                var saved = ports.SavePrincipal(current.Value with { Revision = checked(current.Value.Revision + 1) }, ports.Admission.Fleet.Authorization.Now());
                if (!saved.IsSuccess) return saved;
            }
        }
        return Results.Done();
    }

    private static Result<Unit> Rename(EnrollmentPorts ports, Actor actor, EnrollmentItem item, string requestId)
    {
        if (item.AgentId is null) return Results.Fail<Unit>("conflict", "A registered name requires its approved agent identity");
        var current = ports.Admission.Fleet.Authorization.AgentView(item.AgentId);
        if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
        if (current.Value is null || actor.Kind != "human" || current.Value.Agent.OwnerId != actor.PrincipalId || current.Value.Owner.Status != "active")
            return Results.Fail<Unit>("forbidden", "Only the active human owner may approve an agent name");
        if (current.Value.Name == item.RequestedName) return Results.Done();
        var reserved = ports.Admission.Name(item.RequestedName);
        if (!reserved.IsSuccess) return Result<Unit>.Fail(reserved.Error);
        if (reserved.Value is null || reserved.Value.AgentId is not null || reserved.Value.RequestId != item.RequestId || reserved.Value.InstanceKey != item.InstanceKey)
            return Results.Fail<Unit>("conflict", "The reviewed name reservation changed");
        var removed = ports.RemoveName(current.Value.Name);
        if (!removed.IsSuccess) return removed;
        var claimed = ports.SaveName(new(item.RequestedName, null, null, item.AgentId), false);
        if (!claimed.IsSuccess) return claimed;
        var changed = ports.SavePrincipal(current.Value.Principal with { Revision = checked(current.Value.Principal.Revision + 1) }, ports.Admission.Fleet.Authorization.Now());
        if (!changed.IsSuccess) return changed;
        return ports.Admission.Fleet.Audit(new(requestId, actor.Kind, actor.PrincipalId, current.Value.Agent.OwnerId, "agent", item.AgentId,
            "agent.rename", Message: current.Value.Name + " → " + item.RequestedName));
    }
}
