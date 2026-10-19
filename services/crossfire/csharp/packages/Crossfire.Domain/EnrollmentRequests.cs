using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class EnrollmentRequests
{
    public static Result<Unit> Expire(EnrollmentPorts ports)
    {
        var expired = ports.Expired(ports.Admission.Fleet.Authorization.Now());
        if (!expired.IsSuccess) return Result<Unit>.Fail(expired.Error);
        foreach (var request in expired.Value)
        {
            var names = ports.ReleaseNames(request.Id);
            if (!names.IsSuccess) return names;
            var changed = ports.Save(request with { Status = "expired", Revision = checked(request.Revision + 1) }, false);
            if (!changed.IsSuccess) return changed;
        }
        return Results.Done();
    }

    public static Result<EnrollmentReview> Review(EnrollmentPorts ports, EnrollmentRequest request)
    {
        var owner = ports.Admission.Member(request.OwnerId);
        if (!owner.IsSuccess) return Result<EnrollmentReview>.Fail(owner.Error);
        if (owner.Value is null) return Results.Fail<EnrollmentReview>("unavailable", "Enrollment owner is unavailable");
        var items = ports.Items(request.Id);
        if (!items.IsSuccess) return Result<EnrollmentReview>.Fail(items.Error);
        var policies = ports.Policies(request.Id);
        if (!policies.IsSuccess) return Result<EnrollmentReview>.Fail(policies.Error);
        var views = new List<EnrollmentItemReview>();
        foreach (var item in items.Value)
        {
            var policy = policies.Value.FirstOrDefault(value => value.InstanceKey == item.InstanceKey)?.Policy;
            if (policy is null) return Results.Fail<EnrollmentReview>("unavailable", "Enrollment coordination policy is missing");
            string? name = null;
            if (item.AgentId is not null)
            {
                var agent = ports.Admission.Fleet.Authorization.AgentView(item.AgentId);
                if (!agent.IsSuccess) return Result<EnrollmentReview>.Fail(agent.Error);
                name = agent.Value?.Name;
            }
            var senders = new List<BackendWakeSender>();
            foreach (var sender in policy.Senders)
            {
                var selected = ports.Admission.Fleet.Authorization.Principal(sender.PrincipalId);
                if (!selected.IsSuccess) return Result<EnrollmentReview>.Fail(selected.Error);
                if (selected.Value is null) return Results.Fail<EnrollmentReview>("unavailable", "Enrollment selected identity is missing");
                senders.Add(new(selected.Value.BackendUserId, sender.IncludeAgents));
            }
            views.Add(new(item, name, new(policy.WakeMode, senders.OrderBy(value => value.BackendUserId, StringComparer.Ordinal).ToArray(), policy.Permissions)));
        }
        return Result<EnrollmentReview>.Success(new(request, owner.Value, views));
    }

    public static Result<EnrollmentReview> Read(EnrollmentPorts ports, Actor actor, string enrollmentId)
    {
        var request = ports.Find(enrollmentId);
        if (!request.IsSuccess) return Result<EnrollmentReview>.Fail(request.Error);
        if (request.Value is null) return Results.Fail<EnrollmentReview>("missing", "Enrollment not found");
        var scope = OwnerScopes.Read(ports.Admission.Fleet.Authorization, actor, "enrollment.read", request.Value.OwnerId);
        return scope.IsSuccess ? Review(ports, request.Value) : Result<EnrollmentReview>.Fail(scope.Error);
    }

    public static async ValueTask<Result<EnrollmentReview>> Introduce(EnrollmentPorts ports, EnrollmentIntroduction input, CancellationToken cancellation = default)
    {
        if (input.EnrollmentId.Length != 36 || input.EnrollmentId.Any(character => character is not (>= 'a' and <= 'f' or >= '0' and <= '9' or '-'))
            || input.ClaimSecret.Length != 43 || input.ClaimSecret.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not ('_' or '-')))
            return Results.Fail<EnrollmentReview>("invalid", "Persist a request UUID and private 32-byte claim before enrollment");
        var valid = EnrollmentValidation.Roster(input.Roster);
        if (!valid.IsSuccess) return Result<EnrollmentReview>.Fail(valid.Error);
        var digest = RosterValues.Digest(input.Roster);
        var prior = ports.Find(input.EnrollmentId);
        if (!prior.IsSuccess) return Result<EnrollmentReview>.Fail(prior.Error);
        if (prior.Value is not null) return Repeat(ports, input, prior.Value, digest);
        var verified = await EnrollmentAdmission.Verify(ports.Admission, input.Roster, cancellation);
        if (!verified.IsSuccess) return Result<EnrollmentReview>.Fail(verified.Error);
        return ports.Transaction.Run(() => Create(ports, input, verified.Value, digest));
    }

    private static Result<EnrollmentReview> Repeat(EnrollmentPorts ports, EnrollmentIntroduction input, EnrollmentRequest prior, string digest)
        => prior.ExpiresAt <= ports.Admission.Fleet.Authorization.Now() || prior.RosterDigest != digest || !Identity.Matches(input.ClaimSecret, prior.ClaimHash)
            ? Results.Fail<EnrollmentReview>("conflict", "Enrollment request belongs to different credentials or roster, or has expired") : Review(ports, prior);

    private static Result<EnrollmentReview> Create(EnrollmentPorts ports, EnrollmentIntroduction input, VerifiedRoster verified, string digest)
    {
        var expired = Expire(ports);
        if (!expired.IsSuccess) return Result<EnrollmentReview>.Fail(expired.Error);
        var previous = ports.Find(input.EnrollmentId);
        if (!previous.IsSuccess) return Result<EnrollmentReview>.Fail(previous.Error);
        if (previous.Value is not null) return Repeat(ports, input, previous.Value, digest);
        var authority = ports.Admission.Fleet.Authorization;
        var owner = authority.Principal(verified.OwnerId);
        if (!owner.IsSuccess) return Result<EnrollmentReview>.Fail(owner.Error);
        if (owner.Value is null || owner.Value.Revision != verified.OwnerRevision || owner.Value.Status != "active")
            return Results.Fail<EnrollmentReview>("conflict", "Owner authority changed");
        foreach (var item in verified.Existing)
        {
            var principal = authority.Principal(item.AgentId);
            if (!principal.IsSuccess) return Result<EnrollmentReview>.Fail(principal.Error);
            if (principal.Value is null || principal.Value.Status != "active" && !(item.Retired && principal.Value.Status == "suspended") || principal.Value.Revision != item.Revision)
                return Results.Fail<EnrollmentReview>("conflict", "Existing agent authority changed");
        }
        var admitted = EnrollmentAdmission.Admit(ports.Admission, input.Roster, verified);
        if (!admitted.IsSuccess) return Result<EnrollmentReview>.Fail(admitted.Error);
        var capacity = EnrollmentAdmission.Capacity(ports.Admission, verified.OwnerId);
        if (!capacity.IsSuccess) return Result<EnrollmentReview>.Fail(capacity.Error);
        var pending = ports.PendingCount();
        if (!pending.IsSuccess) return Result<EnrollmentReview>.Fail(pending.Error);
        if (pending.Value >= capacity.Value.Policy.MaxPending) return Results.Fail<EnrollmentReview>("limit", "Pending enrollment capacity reached");
        var now = authority.Now();
        var request = new EnrollmentRequest(input.EnrollmentId, verified.OwnerId, input.Roster.FleetKey, input.Roster.Controller.Name,
            Identity.Hash(FleetAuthority.ControllerToken(input.EnrollmentId, input.ClaimSecret)), Identity.VerificationCode(), Identity.Hash(input.ClaimSecret), digest,
            "pending", 0, now, checked(now + capacity.Value.Policy.EnrollmentSeconds * 1000), null, null);
        var saved = ports.Save(request, true);
        if (!saved.IsSuccess) return Result<EnrollmentReview>.Fail(saved.Error);
        var metadata = ports.SaveMetadata(request.Id, input.Roster.Controller.Metadata);
        if (!metadata.IsSuccess) return Result<EnrollmentReview>.Fail(metadata.Error);
        var unchanged = true;
        var entries = new List<EnrollmentItem>();
        foreach (var item in input.Roster.Instances)
        {
            var existing = verified.Existing.FirstOrDefault(value => value.InstanceKey == item.InstanceKey);
            var record = new EnrollmentItem(request.Id, item.InstanceKey, item.Name, existing is null ? "claimed" : "existing", existing?.AgentId);
            var added = ports.SaveItem(record, true);
            if (!added.IsSuccess) return Result<EnrollmentReview>.Fail(added.Error);
            var policy = verified.Policies.Single(value => value.InstanceKey == item.InstanceKey).Policy;
            var valid = WakeChanges.Validate(authority, existing?.AgentId, policy.WakeMode, policy.Senders);
            if (!valid.IsSuccess) return Result<EnrollmentReview>.Fail(valid.Error);
            var savedPolicy = ports.SavePolicy(record, policy);
            if (!savedPolicy.IsSuccess) return Result<EnrollmentReview>.Fail(savedPolicy.Error);
            if (existing is null || existing.Name != item.Name)
            {
                var claimed = ports.SaveName(new(item.Name, request.Id, item.InstanceKey, null), true);
                if (!claimed.IsSuccess) return Result<EnrollmentReview>.Fail(claimed.Error);
            }
            unchanged &= existing is { Retired: false } && existing.Name == item.Name;
            if (existing is not null)
            {
                var matches = EnrollmentCoordination.Matches(ports, existing.AgentId, policy);
                if (!matches.IsSuccess) return Result<EnrollmentReview>.Fail(matches.Error);
                unchanged &= matches.Value;
            }
            entries.Add(record);
        }
        var fleet = ports.Admission.ByKey(verified.OwnerId, request.FleetKey);
        if (!fleet.IsSuccess) return Result<EnrollmentReview>.Fail(fleet.Error);
        if (unchanged && fleet.Value is { ArchivedAt: null })
        {
            var bound = EnrollmentFleets.Bind(ports, fleet.Value, entries);
            if (!bound.IsSuccess) return Result<EnrollmentReview>.Fail(bound.Error);
            request = request with { Status = "approved", Revision = 1 };
            var finished = ports.Save(request, false);
            if (!finished.IsSuccess) return Result<EnrollmentReview>.Fail(finished.Error);
        }
        return Review(ports, request);
    }
}
