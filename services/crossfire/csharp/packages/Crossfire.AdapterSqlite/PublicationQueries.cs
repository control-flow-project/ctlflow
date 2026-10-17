using Crossfire.AdapterSqlite.Entities;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class PublicationQueries
{
    public static Publication Publication(PublicationRow row) => new(row.Id, row.AgentId, row.PublicKey, row.Title, row.State, row.Revision, row.CreatedAt, row.ExpiresAt, row.PublishedAt, row.DeletedAt, row.CleanedAt, row.TotalBytes, row.FileCount);
    public static PublicationFile File(PublicationFileRow row) => new(row.Id, row.PublicationId, new(row.Path, row.MediaType, row.Bytes, row.Sha256), row.Uploaded == 1);
    public static Result<PublicationRecord?> Find(CrossfireDbContext context, string id)
        => Stored.Read(() => context.Publication.AsNoTracking().Where(row => row.Id == id)
            .Join(context.Agent, publication => publication.AgentId, agent => agent.PrincipalId, (publication, agent) => new { publication, agent })
            .Join(context.AgentName, joined => joined.agent.PrincipalId, name => name.AgentId, (joined, name) => new { joined.publication, joined.agent, name })
            .Join(context.Member, joined => joined.agent.OwnerId, owner => owner.PrincipalId, (joined, owner) => new { joined.publication, joined.agent, joined.name, owner }).SingleOrDefault())
            .Map(value => value is null ? null : new PublicationRecord(Publication(value.publication), value.name.Name, value.agent.OwnerId, value.owner.DisplayName));
    public static Result<IReadOnlyList<PublicationFile>> Files(CrossfireDbContext context, string id)
        => Stored.Read(() => context.PublicationFile.AsNoTracking().Where(row => row.PublicationId == id).OrderBy(row => row.Path).ToArray()).Map<IReadOnlyList<PublicationFile>>(values => values.Select(File).ToArray());
    public static Result<PublicationUsage> Usage(CrossfireDbContext context, string agentId)
    {
        var all = Stored.Read(() => context.Publication.AsNoTracking().Where(row => row.CleanedAt == null).GroupBy(row => 1)
            .Select(group => new { Bytes = group.Sum(row => row.TotalBytes), Count = group.LongCount() }).SingleOrDefault()); if (!all.IsSuccess) return Result<PublicationUsage>.Fail(all.Error);
        return Stored.Read(() => context.Publication.AsNoTracking().Where(row => row.CleanedAt == null && row.AgentId == agentId).GroupBy(row => 1)
            .Select(group => new { Bytes = group.Sum(row => row.TotalBytes), Count = group.LongCount() }).SingleOrDefault())
            .Map(value => new PublicationUsage(all.Value?.Bytes ?? 0, value?.Bytes ?? 0, all.Value?.Count ?? 0, value?.Count ?? 0));
    }
    public static Result<Page<PublicationRecord>> Page(CrossfireDbContext context, PublicationQuery input)
    {
        var owner = input.OwnerId; var agent = input.AgentId; var state = input.State; var search = "%" + input.Search + "%"; var offset = checked((input.Page - 1) * input.PageSize); var size = input.PageSize;
        var count = Stored.Read(() => context.Publication.AsNoTracking().Join(context.Agent, publication => publication.AgentId, agent => agent.PrincipalId, (publication, agent) => new { publication, agent })
            .LongCount(value => (owner == null || value.agent.OwnerId == owner) && (agent == null || value.agent.PrincipalId == agent) && (state == null || value.publication.State == state) && EF.Functions.Like(value.publication.Title, search)));
        if (!count.IsSuccess) return Result<Page<PublicationRecord>>.Fail(count.Error);
        return Stored.Read(() => context.Publication.AsNoTracking().Join(context.Agent, publication => publication.AgentId, agent => agent.PrincipalId, (publication, agent) => new { publication, agent })
            .Join(context.AgentName, joined => joined.agent.PrincipalId, name => name.AgentId, (joined, name) => new { joined.publication, joined.agent, name })
            .Join(context.Member, joined => joined.agent.OwnerId, owner => owner.PrincipalId, (joined, owner) => new { joined.publication, joined.agent, joined.name, owner })
            .Where(value => (owner == null || value.agent.OwnerId == owner) && (agent == null || value.agent.PrincipalId == agent) && (state == null || value.publication.State == state) && EF.Functions.Like(value.publication.Title, search))
            .OrderByDescending(value => value.publication.CreatedAt).ThenByDescending(value => value.publication.Id).Skip(offset).Take(size).ToArray())
            .Map(values => new Page<PublicationRecord>(values.Select(value => new PublicationRecord(Publication(value.publication), value.name.Name, value.agent.OwnerId, value.owner.DisplayName)).ToArray(), input.Page, size, count.Value));
    }
    public static Result<IReadOnlyList<Publication>> Maintenance(CrossfireDbContext context, long now, int limit)
        => Stored.Read(() => context.Publication.AsNoTracking().Where(row => row.CleanedAt == null && (row.State == "deleted" || row.State == "staging" && row.ExpiresAt <= now))
            .OrderBy(row => row.ExpiresAt).ThenBy(row => row.Id).Take(limit).ToArray()).Map<IReadOnlyList<Publication>>(values => values.Select(Publication).ToArray());
    public static Result<PublicReportFile?> PublicFile(CrossfireDbContext context, string key, string path)
        => Stored.Read(() => context.Publication.AsNoTracking().Where(row => row.PublicKey == key && row.State == "published")
            .Join(context.PublicationFile.Where(row => row.Path == path && row.Uploaded == 1), publication => publication.Id, file => file.PublicationId, (publication, file) => new { publication, file }).SingleOrDefault())
            .Map(value => value is null ? null : new PublicReportFile(Publication(value.publication), File(value.file)));
}
