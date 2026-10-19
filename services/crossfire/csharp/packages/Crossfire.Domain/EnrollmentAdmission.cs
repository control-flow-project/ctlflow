using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class EnrollmentAdmission
{
    public static Result<EnrollmentCapacity> Capacity(EnrollmentAdmissionPorts ports, string ownerId)
    {
        var policy = ports.Policy();
        if (!policy.IsSuccess) return Result<EnrollmentCapacity>.Fail(policy.Error);
        if (policy.Value is null) return Results.Fail<EnrollmentCapacity>("unavailable", "Instance is not initialized");
        var member = ports.Member(ownerId);
        if (!member.IsSuccess) return Result<EnrollmentCapacity>.Fail(member.Error);
        if (member.Value is null || member.Value.Role.PrincipalKind != "human" || member.Value.Role.RoleCode is not ("member" or "administrator"))
            return Results.Fail<EnrollmentCapacity>("forbidden", "An enrolled human owner role is required");
        var active = ports.ActiveAgents(null);
        if (!active.IsSuccess) return Result<EnrollmentCapacity>.Fail(active.Error);
        var owned = ports.ActiveAgents(ownerId);
        if (!owned.IsSuccess) return Result<EnrollmentCapacity>.Fail(owned.Error);
        var pending = ports.PendingIdentities(null);
        if (!pending.IsSuccess) return Result<EnrollmentCapacity>.Fail(pending.Error);
        var ownedPending = ports.PendingIdentities(ownerId);
        if (!ownedPending.IsSuccess) return Result<EnrollmentCapacity>.Fail(ownedPending.Error);
        var ownerLimit = member.Value.Role.RoleCode == "administrator" ? policy.Value.MaxAgents : policy.Value.MaxOwnerAgents;
        var instanceCount = checked(active.Value + pending.Value); var ownerCount = checked(owned.Value + ownedPending.Value);
        return Result<EnrollmentCapacity>.Success(new(policy.Value, ownerLimit, ownerCount, instanceCount,
            Math.Min(policy.Value.MaxAgents - instanceCount, ownerLimit - ownerCount)));
    }

    public static async ValueTask<Result<VerifiedRoster>> Verify(EnrollmentAdmissionPorts ports, EnrollmentRoster input, CancellationToken cancellation = default)
    {
        var valid = EnrollmentValidation.Roster(input);
        if (!valid.IsSuccess) return Result<VerifiedRoster>.Fail(valid.Error);
        var owner = ports.PrincipalByBackendUserId(input.OwnerBackendUserId);
        if (!owner.IsSuccess) return Result<VerifiedRoster>.Fail(owner.Error);
        if (owner.Value is not { Kind: "human", Status: "active" }) return Results.Fail<VerifiedRoster>("forbidden", "An active human owner is required");
        var fleet = ports.ByKey(owner.Value.Id, input.FleetKey);
        if (!fleet.IsSuccess) return Result<VerifiedRoster>.Fail(fleet.Error);
        if (fleet.Value is { ArchivedAt: null })
        {
            var controller = FleetAuthority.Authenticate(ports.Fleet, input.ControllerCredential ?? "");
            if (!controller.IsSuccess) return Result<VerifiedRoster>.Fail(controller.Error);
            if (controller.Value.FleetId != fleet.Value.Id) return Results.Fail<VerifiedRoster>("forbidden", "Controller credential belongs to another fleet");
        }
        else if (input.ControllerCredential is not null) return Results.Fail<VerifiedRoster>("invalid", "Controller credential has no fleet");
        var existing = new List<EnrollmentExisting>();
        foreach (var item in input.Instances)
        {
            var binding = ports.Binding(owner.Value.Id, input.FleetKey, item.InstanceKey);
            if (!binding.IsSuccess) return Result<VerifiedRoster>.Fail(binding.Error);
            if (binding.Value is not null && binding.Value.AgentId != item.AgentId)
                return Results.Fail<VerifiedRoster>("conflict", "Missing matching private credentials for saved fleet instance " + item.InstanceKey);
            if (item.AgentId is null) continue;
            var record = ports.Fleet.Authorization.AgentView(item.AgentId);
            if (!record.IsSuccess) return Result<VerifiedRoster>.Fail(record.Error);
            var current = ports.Fleet.Authorization.Binding(item.AgentId);
            if (!current.IsSuccess) return Result<VerifiedRoster>.Fail(current.Error);
            var retired = current.Value?.RetiredAt is not null;
            if (record.Value is null || record.Value.Agent.OwnerId != owner.Value.Id || record.Value.Owner.Status != "active"
                || record.Value.Principal.Status != "active" && !(retired && record.Value.Principal.Status == "suspended"))
                return Results.Fail<VerifiedRoster>("forbidden", "Existing identity proof does not match the owner and agent");
            if (retired)
            {
                var credential = ports.AgentToken(item.AgentId);
                if (!credential.IsSuccess) return Result<VerifiedRoster>.Fail(credential.Error);
                if (string.IsNullOrEmpty(credential.Value) || credential.Value != item.AccessToken)
                    return Results.Fail<VerifiedRoster>("forbidden", "Retired identity requires its preserved private credentials and owner approval");
            }
            else
            {
                var native = await ports.Identify(item.AccessToken ?? "", cancellation);
                if (!native.IsSuccess) return Result<VerifiedRoster>.Fail(native.Error);
                if (record.Value.Principal.BackendUserId != native.Value) return Results.Fail<VerifiedRoster>("forbidden", "Native identity does not match this agent");
            }
            if (current.Value is not null && (current.Value.FleetKey != input.FleetKey || current.Value.OwnerId != owner.Value.Id || current.Value.InstanceKey != item.InstanceKey))
                return Results.Fail<VerifiedRoster>("conflict", "Agent already belongs to another fleet instance");
            existing.Add(new(item.InstanceKey, item.AgentId, record.Value.Name, record.Value.Principal.Revision, retired,
                current.Value is { RetiredAt: null } && fleet.Value is { ArchivedAt: null }));
        }
        var policies = new List<EnrollmentPolicy>();
        foreach (var item in input.Instances)
        {
            var selections = new List<WakeSelection>();
            foreach (var sender in item.CoordinationPolicy.Senders)
            {
                var selected = ports.PrincipalByBackendUserId(sender.BackendUserId);
                if (!selected.IsSuccess) return Result<VerifiedRoster>.Fail(selected.Error);
                if (selected.Value is null) return Results.Fail<VerifiedRoster>("invalid", "Selected identity is not registered: " + sender.BackendUserId);
                selections.Add(new(selected.Value.Id, sender.IncludeAgents));
            }
            var proof = existing.FirstOrDefault(value => value.InstanceKey == item.InstanceKey);
            var policy = WakeChanges.Validate(ports.Fleet.Authorization, proof?.AgentId, item.CoordinationPolicy.WakeMode, selections);
            if (!policy.IsSuccess) return Result<VerifiedRoster>.Fail(policy.Error);
            policies.Add(new(item.InstanceKey, new(item.CoordinationPolicy.WakeMode, selections.OrderBy(value => value.PrincipalId, StringComparer.Ordinal).ToArray(),
                item.CoordinationPolicy.Permissions.Order(StringComparer.Ordinal).ToArray(), proof?.Revision)));
        }
        return Result<VerifiedRoster>.Success(new(owner.Value.Id, owner.Value.Revision, existing, policies));
    }

    public static Result<Unit> Admit(EnrollmentAdmissionPorts ports, EnrollmentRoster input, VerifiedRoster verified)
    {
        var collisions = new List<string>();
        foreach (var item in input.Instances)
        {
            var name = ports.Name(item.Name);
            if (!name.IsSuccess) return Result<Unit>.Fail(name.Error);
            if (name.Value is not null && !verified.Existing.Any(value => value.InstanceKey == item.InstanceKey && value.AgentId == name.Value.AgentId)) collisions.Add(item.Name);
            var binding = ports.Binding(verified.OwnerId, input.FleetKey, item.InstanceKey);
            if (!binding.IsSuccess) return Result<Unit>.Fail(binding.Error);
            if (binding.Value is not null && !verified.Existing.Any(value => value.InstanceKey == item.InstanceKey && value.AgentId == binding.Value.AgentId))
                return Results.Fail<Unit>("conflict", "Missing private credentials for saved fleet instance " + item.InstanceKey);
        }
        if (collisions.Count != 0) return Results.Fail<Unit>("name_collision", "Name collision: " + string.Join(", ", collisions));
        var capacity = Capacity(ports, verified.OwnerId);
        if (!capacity.IsSuccess) return Result<Unit>.Fail(capacity.Error);
        var additional = input.Instances.Count - verified.Existing.Count(value => value.Operational);
        return additional > capacity.Value.Remaining
            ? Results.Fail<Unit>("capacity", "Enrollment needs " + additional + " new agents; owner capacity is " + capacity.Value.OwnerCount + "/" + capacity.Value.OwnerLimit
                + " and instance capacity is " + capacity.Value.InstanceCount + "/" + capacity.Value.Policy.MaxAgents + ". Ask an administrator to adjust the applicable limits.")
            : Results.Done();
    }

    public static async ValueTask<Result<int>> Preflight(EnrollmentAdmissionPorts ports, EnrollmentRoster input, CancellationToken cancellation = default)
    {
        var verified = await Verify(ports, input, cancellation);
        return verified.IsSuccess ? Admit(ports, input, verified.Value).Map(_ => input.Instances.Count) : Result<int>.Fail(verified.Error);
    }
}
