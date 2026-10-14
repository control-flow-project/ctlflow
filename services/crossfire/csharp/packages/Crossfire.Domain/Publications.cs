using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class Publications
{
    private static Result<Unit> Lease(PublicationPorts ports, string agentId)
    {
        var active = ListenerReporting.Activity(ports.Listener, agentId);
        return !active.IsSuccess ? Result<Unit>.Fail(active.Error) : active.Value.ActiveRuns.Any(value => value.DisconnectRequestedAt is null) ? Results.Done() : Results.Fail<Unit>("forbidden", "Publication requires the current authenticated fleet controller listener");
    }
    public static Result<PublicationRecord> Authority(PublicationPorts ports, Actor actor, string id, string action)
    {
        var authorization = ports.Listener.Fleet.Authorization; var active = Authorization.ActiveActor(authorization, actor); if (!active.IsSuccess) return Result<PublicationRecord>.Fail(active.Error);
        if (actor.Kind == "agent") { var lease = Lease(ports, actor.PrincipalId); if (!lease.IsSuccess) return Result<PublicationRecord>.Fail(lease.Error); }
        var record = ports.Find(id); if (!record.IsSuccess) return Result<PublicationRecord>.Fail(record.Error);
        if (record.Value is null) return Results.Fail<PublicationRecord>("missing", "Report not found");
        var permissions = authorization.Permissions(actor.PrincipalId); if (!permissions.IsSuccess) return Result<PublicationRecord>.Fail(permissions.Error);
        var allowed = action != "delete" && actor.Kind == "agent" && actor.PrincipalId == record.Value.Publication.AgentId && permissions.Value.Contains("publication.publish.self", StringComparer.Ordinal)
            || action != "publish" && actor.Kind == "human" && (permissions.Value.Contains("publication." + action + ".any", StringComparer.Ordinal) || record.Value.OwnerId == actor.PrincipalId && permissions.Value.Contains("publication." + action + ".owned", StringComparer.Ordinal));
        return allowed ? Result<PublicationRecord>.Success(record.Value) : Results.Fail<PublicationRecord>("missing", "Report not found");
    }
    private static PublicationSummary Summary(PublicationPorts ports, Actor actor, IReadOnlyList<string> permissions, PublicationRecord record)
        => new(record, record.Publication.State == "published" ? ports.Origin + "/" + record.Publication.PublicKey + "/index.html" : null,
            actor.Kind == "human" && record.Publication.State != "deleted" && (permissions.Contains("publication.delete.any", StringComparer.Ordinal) || record.OwnerId == actor.PrincipalId && permissions.Contains("publication.delete.owned", StringComparer.Ordinal)) ? ["delete"] : []);
    public static Result<PublicationDetails> Read(PublicationPorts ports, Actor actor, string id)
    {
        var record = Authority(ports, actor, id, "read"); if (!record.IsSuccess) return Result<PublicationDetails>.Fail(record.Error);
        var permissions = ports.Listener.Fleet.Authorization.Permissions(actor.PrincipalId); if (!permissions.IsSuccess) return Result<PublicationDetails>.Fail(permissions.Error);
        return ports.Files(id).Map(files => new PublicationDetails(Summary(ports, actor, permissions.Value, record.Value), files));
    }
    public static Result<Page<PublicationSummary>> List(PublicationPorts ports, Actor actor, PublicationQuery input)
    {
        var active = Authorization.ActiveActor(ports.Listener.Fleet.Authorization, actor); if (!active.IsSuccess) return Result<Page<PublicationSummary>>.Fail(active.Error);
        var permissions = ports.Listener.Fleet.Authorization.Permissions(actor.PrincipalId); if (!permissions.IsSuccess) return Result<Page<PublicationSummary>>.Fail(permissions.Error);
        var all = permissions.Value.Contains("publication.read.any", StringComparer.Ordinal);
        if (actor.Kind != "human" || !all && (!permissions.Value.Contains("publication.read.owned", StringComparer.Ordinal) || input.OwnerId is not null && input.OwnerId != actor.PrincipalId)) return Results.Fail<Page<PublicationSummary>>("forbidden", "Report owner scope is not permitted");
        return ports.Page(all ? input : input with { OwnerId = actor.PrincipalId }).Map(page => new Page<PublicationSummary>(page.Items.Select(value => Summary(ports, actor, permissions.Value, value)).ToArray(), page.PageNumber, page.PageSize, page.TotalItems));
    }
    public static Result<PublicationDetails> Create(PublicationPorts ports, Actor actor, PublicationCreation input, string requestId)
    {
        var valid = PublicationValues.Validate(input); if (!valid.IsSuccess) return Result<PublicationDetails>.Fail(valid.Error);
        return ports.Listener.Fleet.Transaction.Run(() =>
        {
            if (actor.Kind != "agent") return Results.Fail<PublicationDetails>("forbidden", "Only enrolled agents publish reports");
            var allowed = Authorization.Require(ports.Listener.Fleet.Authorization, actor, "publication.publish.self"); if (!allowed.IsSuccess) return Result<PublicationDetails>.Fail(allowed.Error);
            var lease = Lease(ports, actor.PrincipalId); if (!lease.IsSuccess) return Result<PublicationDetails>.Fail(lease.Error);
            var usage = ports.Usage(actor.PrincipalId); if (!usage.IsSuccess) return Result<PublicationDetails>.Fail(usage.Error);
            var budget = ports.Budget;
            if (usage.Value.InstanceBytes + valid.Value > budget.InstanceBytes || usage.Value.AgentBytes + valid.Value > budget.AgentBytes || usage.Value.InstanceCount >= budget.InstanceCount || usage.Value.AgentCount >= budget.AgentCount)
                return Results.Fail<PublicationDetails>("capacity", "Report storage capacity reached; remove unused reports before publishing");
            var id = Identity.Identifier(); var now = ports.Listener.Fleet.Authorization.Now();
            var created = ports.Insert(new(id, actor.PrincipalId, Identity.Secret(), input.Title, "staging", 0, now, now + 3600000, null, null, null, valid.Value, input.Files.Count), input.Files.Select(file => new PublicationFile(Identity.Identifier(), id, file, false)).ToArray());
            if (!created.IsSuccess) return Result<PublicationDetails>.Fail(created.Error);
            var agent = ports.Listener.Fleet.Authorization.Agent(actor.PrincipalId); if (!agent.IsSuccess) return Result<PublicationDetails>.Fail(agent.Error);
            var audit = ports.Listener.Fleet.Audit(new(requestId, actor.Kind, actor.PrincipalId, agent.Value!.OwnerId, "publication", id, "publication.create", PermissionCode: "publication.publish.self"));
            return audit.IsSuccess ? Read(ports, actor, id) : Result<PublicationDetails>.Fail(audit.Error);
        });
    }
    public static ValueTask<Result<Unit>> Upload(PublicationPorts ports, Actor actor, string id, string fileId, long length, Stream input, CancellationToken cancellation = default)
        => ports.Store.Exclusive(id, async () =>
        {
            var current = Authority(ports, actor, id, "publish"); if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
            if (current.Value.Publication.State != "staging" || current.Value.Publication.ExpiresAt <= ports.Listener.Fleet.Authorization.Now()) return Results.Fail<Unit>("conflict", "Report staging is no longer writable");
            var files = ports.Files(id); if (!files.IsSuccess) return Result<Unit>.Fail(files.Error); var file = files.Value.SingleOrDefault(value => value.Id == fileId);
            if (file is null) return Results.Fail<Unit>("missing", "Declared report file not found");
            if (length != file.Manifest.Bytes) return Results.Fail<Unit>("invalid", "Upload size does not match its declared file");
            var stored = await ports.Store.Upload(id, file, input, cancellation); if (!stored.IsSuccess) return stored;
            return ports.Listener.Fleet.Transaction.Run(() =>
            {
                var authority = Authority(ports, actor, id, "publish"); if (!authority.IsSuccess) return Result<Unit>.Fail(authority.Error);
                return authority.Value.Publication.State != "staging" || authority.Value.Publication.ExpiresAt <= ports.Listener.Fleet.Authorization.Now()
                    ? Results.Fail<Unit>("conflict", "Report staging changed during upload") : ports.Uploaded(id, fileId);
            });
        });
    public static ValueTask<Result<PublicationDetails>> Commit(PublicationPorts ports, Actor actor, string id, long revision, string requestId, CancellationToken cancellation = default)
        => ports.Store.Exclusive(id, async () =>
        {
            var current = Authority(ports, actor, id, "publish"); if (!current.IsSuccess) return Result<PublicationDetails>.Fail(current.Error);
            var publication = current.Value.Publication;
            if (publication.State == "published" && publication.Revision == revision + 1) return Read(ports, actor, id);
            if (publication.State != "staging" || publication.Revision != revision || publication.ExpiresAt <= ports.Listener.Fleet.Authorization.Now()) return Results.Fail<PublicationDetails>("conflict", "Report staging or revision changed");
            var files = ports.Files(id); if (!files.IsSuccess) return Result<PublicationDetails>.Fail(files.Error);
            if (files.Value.Any(value => !value.Uploaded)) return Results.Fail<PublicationDetails>("conflict", "Every declared report file must be uploaded before publication");
            var verified = await ports.Store.Verify(id, files.Value, cancellation); if (!verified.IsSuccess) return Result<PublicationDetails>.Fail(verified.Error);
            return ports.Listener.Fleet.Transaction.Run(() =>
            {
                var checkedAuthority = Authority(ports, actor, id, "publish"); if (!checkedAuthority.IsSuccess) return Result<PublicationDetails>.Fail(checkedAuthority.Error);
                var saved = ports.Publish(id, revision, ports.Listener.Fleet.Authorization.Now()); if (!saved.IsSuccess) return Result<PublicationDetails>.Fail(saved.Error);
                var audit = ports.Listener.Fleet.Audit(new(requestId, actor.Kind, actor.PrincipalId, checkedAuthority.Value.OwnerId, "publication", id, "publication.publish", PermissionCode: "publication.publish.self"));
                return audit.IsSuccess ? Read(ports, actor, id) : Result<PublicationDetails>.Fail(audit.Error);
            });
        });
    public static async ValueTask<Result<Unit>> Delete(PublicationPorts ports, Actor actor, string id, long revision, string requestId)
    {
        var fenced = ports.Listener.Fleet.Transaction.Run(() =>
        {
            var current = Authority(ports, actor, id, "delete"); if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
            if (current.Value.Publication.State == "deleted" && current.Value.Publication.Revision == revision + 1) return Results.Done();
            var saved = ports.Fence(id, revision, ports.Listener.Fleet.Authorization.Now()); if (!saved.IsSuccess) return saved;
            return ports.Listener.Fleet.Audit(new(requestId, actor.Kind, actor.PrincipalId, current.Value.OwnerId, "publication", id, "publication.delete"));
        });
        if (!fenced.IsSuccess) return fenced;
        await ports.Store.Exclusive(id, () => ValueTask.FromResult(ports.Store.Remove(id).Bind(_ => ports.Cleaned(id, ports.Listener.Fleet.Authorization.Now()))));
        return Results.Done();
    }
    public static async ValueTask<Result<long>> Maintain(PublicationPorts ports)
    {
        var pending = ports.Maintenance(ports.Listener.Fleet.Authorization.Now(), 50); if (!pending.IsSuccess) return Result<long>.Fail(pending.Error);
        long completed = 0; Failure? failure = null;
        foreach (var publication in pending.Value)
        {
            var result = await ports.Store.Exclusive(publication.Id, () =>
            {
                var current = ports.Find(publication.Id); if (!current.IsSuccess) return ValueTask.FromResult(Result<bool>.Fail(current.Error));
                if (current.Value is null || current.Value.Publication.CleanedAt is not null || current.Value.Publication.State == "published") return ValueTask.FromResult(Result<bool>.Success(false));
                if (current.Value.Publication.State == "staging")
                {
                    if (current.Value.Publication.ExpiresAt > ports.Listener.Fleet.Authorization.Now()) return ValueTask.FromResult(Result<bool>.Success(false));
                    var fenced = ports.Listener.Fleet.Transaction.Run(() => ports.Fence(publication.Id, current.Value.Publication.Revision, ports.Listener.Fleet.Authorization.Now())); if (!fenced.IsSuccess) return ValueTask.FromResult(Result<bool>.Fail(fenced.Error));
                }
                return ValueTask.FromResult(ports.Store.Remove(publication.Id).Bind(_ => ports.Cleaned(publication.Id, ports.Listener.Fleet.Authorization.Now())).Map(_ => true));
            });
            if (result.IsSuccess && result.Value) completed++; else if (!result.IsSuccess && result.Error.Code != "conflict") failure = result.Error;
        }
        return failure is null ? Result<long>.Success(completed) : Result<long>.Fail(failure);
    }
}
