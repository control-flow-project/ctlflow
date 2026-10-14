using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class PublicationCommands
{
    public static Result<Unit> Insert(CrossfireDbContext context, Publication value, IReadOnlyList<PublicationFile> files)
    {
        context.Publication.Add(new() { Id = value.Id, AgentId = value.AgentId, PublicKey = value.PublicKey, Title = value.Title, State = value.State,
            Revision = value.Revision, CreatedAt = value.CreatedAt, ExpiresAt = value.ExpiresAt, PublishedAt = value.PublishedAt, DeletedAt = value.DeletedAt, CleanedAt = value.CleanedAt, TotalBytes = value.TotalBytes, FileCount = value.FileCount });
        foreach (var file in files) context.PublicationFile.Add(new() { Id = file.Id, PublicationId = file.PublicationId, Path = file.Manifest.Path, MediaType = file.Manifest.MediaType, Bytes = file.Manifest.Bytes, Sha256 = file.Manifest.Sha256, Uploaded = file.Uploaded ? 1 : 0 });
        context.SaveChanges(); return Results.Done();
    }
    public static Result<Unit> Uploaded(CrossfireDbContext context, string id, string fileId)
        => context.PublicationFile.Where(row => row.Id == fileId && row.PublicationId == id).ExecuteUpdate(update => update.SetProperty(row => row.Uploaded, 1)) == 1 ? Results.Done() : Results.Fail<Unit>("missing", "Report file not found");
    public static Result<Unit> Publish(CrossfireDbContext context, string id, long revision, long now)
    {
        var next = checked(revision + 1);
        return context.Publication.Where(row => row.Id == id && row.Revision == revision && row.State == "staging" && row.ExpiresAt > now)
            .ExecuteUpdate(update => update.SetProperty(row => row.State, "published").SetProperty(row => row.Revision, next).SetProperty(row => row.PublishedAt, (long?)now)) == 1
            ? Results.Done() : Results.Fail<Unit>("conflict", "Report staging changed");
    }
    public static Result<Unit> Fence(CrossfireDbContext context, string id, long revision, long now)
    {
        var next = checked(revision + 1);
        return context.Publication.Where(row => row.Id == id && row.Revision == revision && row.State != "deleted")
            .ExecuteUpdate(update => update.SetProperty(row => row.State, "deleted").SetProperty(row => row.Revision, next).SetProperty(row => row.DeletedAt, (long?)now)) == 1
            ? Results.Done() : Results.Fail<Unit>("conflict", "Report revision changed");
    }
    public static Result<Unit> Cleaned(CrossfireDbContext context, string id, long now)
        => context.Publication.Where(row => row.Id == id && row.State == "deleted").ExecuteUpdate(update => update.SetProperty(row => row.CleanedAt, (long?)now)) == 1 ? Results.Done() : Results.Fail<Unit>("conflict", "Only deleted report storage can be reclaimed");
    public static PublicationPorts Ports(CrossfireDbContext context, Func<long> now, PublicationStorage store, PublicationBudget budget, string origin)
        => new(ListenerCommands.Ports(context, now), store, budget, origin, id => PublicationQueries.Find(context, id), id => PublicationQueries.Files(context, id),
            (value, files) => Insert(context, value, files), (id, file) => Uploaded(context, id, file), (id, revision, at) => Publish(context, id, revision, at),
            (id, revision, at) => Fence(context, id, revision, at), (id, at) => Cleaned(context, id, at), id => PublicationQueries.Usage(context, id), query => PublicationQueries.Page(context, query),
            (at, limit) => PublicationQueries.Maintenance(context, at, limit), (key, path) => PublicationQueries.PublicFile(context, key, path));
}
