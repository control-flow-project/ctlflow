using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class EnrollmentClaims
{
    public static Result<EnrollmentExchange> Exchange(EnrollmentPorts ports, string enrollmentId, string claimSecret)
    {
        var request = ports.Find(enrollmentId);
        if (!request.IsSuccess) return Result<EnrollmentExchange>.Fail(request.Error);
        if (request.Value is null || !Identity.Matches(claimSecret, request.Value.ClaimHash)) return Results.Fail<EnrollmentExchange>("unauthorized", "Invalid enrollment claim");
        var value = request.Value;
        var owner = ports.Admission.Fleet.Authorization.Principal(value.OwnerId);
        if (!owner.IsSuccess) return Result<EnrollmentExchange>.Fail(owner.Error);
        if (owner.Value?.Status != "active") return Results.Fail<EnrollmentExchange>("forbidden", "Owner access is no longer active");
        if (value.ExpiresAt <= ports.Admission.Fleet.Authorization.Now()) return Result<EnrollmentExchange>.Success(new("expired", owner.Value.BackendUserId, null, []));
        if (value.Status != "approved") return Result<EnrollmentExchange>.Success(new(value.Status, owner.Value.BackendUserId, null, []));
        var fleet = ports.Admission.ByKey(value.OwnerId, value.FleetKey);
        if (!fleet.IsSuccess) return Result<EnrollmentExchange>.Fail(fleet.Error);
        if (fleet.Value is null || fleet.Value.ArchivedAt is not null) return Results.Fail<EnrollmentExchange>("forbidden", "Fleet enrollment is no longer current");
        var issued = ports.Admission.Fleet.Credential(enrollmentId);
        if (!issued.IsSuccess) return Result<EnrollmentExchange>.Fail(issued.Error);
        if (issued.Value is { RevokedAt: not null }) return Results.Fail<EnrollmentExchange>("forbidden", "This controller enrollment has been revoked");
        var items = ports.Items(enrollmentId);
        if (!items.IsSuccess) return Result<EnrollmentExchange>.Fail(items.Error);
        var instances = new List<ExchangedInstance>();
        foreach (var item in items.Value)
        {
            if (item.AgentId is null) return Results.Fail<EnrollmentExchange>("unavailable", "Approved identity is not assigned");
            var binding = ports.Admission.Fleet.Authorization.Binding(item.AgentId);
            if (!binding.IsSuccess) return Result<EnrollmentExchange>.Fail(binding.Error);
            if (binding.Value is null || binding.Value.RetiredAt is not null || binding.Value.OwnerId != fleet.Value.OwnerId || binding.Value.FleetKey != fleet.Value.FleetKey
                || binding.Value.InstanceKey != item.InstanceKey) return Results.Fail<EnrollmentExchange>("forbidden", "Agent registration is no longer current");
            var agent = ports.Admission.Fleet.Authorization.AgentView(item.AgentId);
            if (!agent.IsSuccess) return Result<EnrollmentExchange>.Fail(agent.Error);
            var credentials = ports.Credential(item.AgentId);
            if (!credentials.IsSuccess) return Result<EnrollmentExchange>.Fail(credentials.Error);
            if (agent.Value is null || credentials.Value is null || agent.Value.Principal.Status != "active" || agent.Value.Owner.Status != "active")
                return Results.Fail<EnrollmentExchange>("forbidden", "Agent access is no longer active");
            if (agent.Value.Name != item.RequestedName) return Results.Fail<EnrollmentExchange>("conflict", "This enrollment no longer matches the registered agent name");
            var ready = credentials.Value.AccessToken is not null && agent.Value.Application.AppliedStatus == "active"
                && agent.Value.Application.NativeDisplayName == item.RequestedName + " (" + agent.Value.OwnerMember.DisplayName + ")" && agent.Value.Application.ErrorCode is null;
            instances.Add(new(item.InstanceKey, item.RequestedName, item.AgentId, ready ? "ready" : "provisioning", agent.Value.Application.ErrorCode,
                ready ? ports.Messaging.AgentAccount(agent.Value.Principal.BackendUserId, credentials.Value.AccessToken!) : null));
        }
        return Result<EnrollmentExchange>.Success(new(instances.Any(item => item.Status == "provisioning") ? "provisioning" : "ready", owner.Value.BackendUserId,
            new(fleet.Value.Id, issued.Value is { RevokedAt: null } ? FleetAuthority.ControllerToken(enrollmentId, claimSecret) : null), instances));
    }
}
