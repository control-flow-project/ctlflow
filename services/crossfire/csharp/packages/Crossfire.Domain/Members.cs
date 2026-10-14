using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class Members
{
    public static Result<MemberView> Read(MemberPorts ports, Actor actor, string id)
    {
        var authority = Authorization.Require(ports.Authorization, actor, "member.manage");
        if (!authority.IsSuccess) return Result<MemberView>.Fail(authority.Error);
        var found = ports.Find(id);
        return !found.IsSuccess ? Result<MemberView>.Fail(found.Error)
            : found.Value is not null ? Result<MemberView>.Success(found.Value)
            : Results.Fail<MemberView>("missing", "Member not found");
    }

    public static Result<Page<MemberView>> List(MemberPorts ports, Actor actor, int page, int pageSize)
    {
        var authority = Authorization.Require(ports.Authorization, actor, "member.manage");
        return authority.IsSuccess ? ports.List(page, pageSize) : Result<Page<MemberView>>.Fail(authority.Error);
    }

    public static Result<MemberView> Change(MemberPorts ports, Actor actor, string memberId, MemberChange input, string requestId)
    {
        if (input.DisplayName is not null && (input.DisplayName.Length is < 1 or > 100 || input.DisplayName.Any(value => value is <= '\u001f' or '\u007f')))
            return Results.Fail<MemberView>("invalid", "Member names must contain 1–100 characters without control characters");
        return ports.Transaction.Run(() =>
        {
            var selfName = actor.Kind == "human" && actor.Authentication is NativeAuthentication && actor.PrincipalId == memberId
                && input.DisplayName is not null && input.Status is null && input.RoleCode is null;
            var authority = selfName ? Authorization.ActiveActor(ports.Authorization, actor) : Authorization.Require(ports.Authorization, actor, "member.manage");
            if (!authority.IsSuccess) return Result<MemberView>.Fail(authority.Error);
            var found = ports.Find(memberId);
            if (!found.IsSuccess) return Result<MemberView>.Fail(found.Error);
            if (found.Value is null) return Results.Fail<MemberView>("missing", "Member not found");
            var current = found.Value;
            if (current.Principal.Status == "revoked") return Results.Fail<MemberView>("conflict", "Account revocation is permanent");
            if (current.Principal.Revision != input.ExpectedRevision) return Results.Fail<MemberView>("conflict", "Member revision changed");
            var status = input.Status ?? current.Principal.Status;
            var role = input.RoleCode ?? current.Role.RoleCode;
            if (current.Role.RoleCode == "administrator" && current.Principal.Status == "active" && (role != "administrator" || status != "active"))
            {
                var count = ports.ActiveAdministratorCount();
                if (!count.IsSuccess) return Result<MemberView>.Fail(count.Error);
                if (count.Value <= 1) return Results.Fail<MemberView>("forbidden", "At least one active administrator is required");
            }
            var now = ports.Authorization.Now();
            var next = current with
            {
                Principal = current.Principal with { Status = status, Revision = checked(input.ExpectedRevision + 1) },
                Member = current.Member with { DisplayName = input.DisplayName ?? current.Member.DisplayName },
                Role = selfName ? current.Role : current.Role with { RoleCode = role, AssignedByMemberId = actor.PrincipalId, AssignedAt = now },
                Application = current.Application with { NextCheckAt = now }
            };
            var changed = ports.Apply(new(current, next, selfName, now));
            if (!changed.IsSuccess) return Result<MemberView>.Fail(changed.Error);
            var audited = ports.Audit(new(requestId, actor.Kind, actor.PrincipalId, memberId, "member", memberId, "member.configure"));
            return audited.IsSuccess ? Result<MemberView>.Success(next) : Result<MemberView>.Fail(audited.Error);
        });
    }
}
