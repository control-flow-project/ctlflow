using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class PublicationRoutes
{
    public static PublicationPorts Ports(ApiState state, CrossfireDbContext database) => PublicationCommands.Ports(database, state.Now, state.Publications, state.Configuration.PublicationBudget, state.Configuration.ContentOrigin);
    public static IReadOnlyList<ApiEndpoint> Endpoints() =>
    [
        new("createPublication", Create), new("publications", List, ["page", "pageSize", "search", "state", "agentId", "ownerId"]),
        new("publication", (context, parameters, input) => Replies.Ready(Replies.Of(Publications.Read(Ports(context.State, context.Database), context.Actor, parameters["publicationId"]).Map(Details)))),
        new("uploadPublicationFile", Upload), new("commitPublication", (context, parameters, input) => Mutation(context, parameters, input, false)),
        new("deletePublication", (context, parameters, input) => Mutation(context, parameters, input, true))
    ];
    private static Result<PublicationFileInput> File(JsonElement input)
    {
        var fields = Validation.Fields(input, ["path", "mediaType", "bytes", "sha256"]); if (!fields.IsSuccess) return Result<PublicationFileInput>.Fail(fields.Error);
        var path = Validation.Text(input.GetProperty("path"), 240); var media = Validation.Text(input.GetProperty("mediaType"), 100); var bytes = Validation.Integer(input.GetProperty("bytes"), 0, PublicationValues.FileBytes); var digest = Validation.Text(input.GetProperty("sha256"), 64, 64);
        return path.IsSuccess && media.IsSuccess && bytes.IsSuccess && digest.IsSuccess ? Result<PublicationFileInput>.Success(new(path.Value, media.Value, bytes.Value, digest.Value)) : Results.Fail<PublicationFileInput>("invalid", "Invalid static file manifest");
    }
    private static ValueTask<Result<ApiReply>> Create(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["title", "files"]); if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var title = Validation.Text(input.GetProperty("title"), 200); var files = Validation.List(input.GetProperty("files"), File, 512, 1);
        return Replies.Ready(!title.IsSuccess || !files.IsSuccess ? Results.Fail<ApiReply>("invalid", "Invalid static report") : Replies.Of(Publications.Create(Ports(context.State, context.Database), context.Actor, new(title.Value, files.Value), context.RequestId).Map(Details)));
    }
    private static ValueTask<Result<ApiReply>> List(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var page = Transport.Page(context.Query); var state = context.Query.GetValueOrDefault("state"); var owner = context.Query.GetValueOrDefault("ownerId"); var agent = context.Query.GetValueOrDefault("agentId"); var search = context.Query.GetValueOrDefault("search", "");
        if (!page.IsSuccess || state is not (null or "staging" or "published" or "deleted") || owner is not null && !Validation.Identifier(owner) || agent is not null && !Validation.Identifier(agent) || search.Length > 200 || search.Any(value => value is <= '\u001f' or '\u007f')) return Replies.Ready(Results.Fail<ApiReply>("invalid", "Invalid report filters"));
        return Replies.Ready(Replies.Paged(Publications.List(Ports(context.State, context.Database), context.Actor, new(page.Value.Page, page.Value.PageSize, search, state, agent, owner)), context.RequestId, (writer, value) => { writer.WriteStartObject(); Summary(writer, value); writer.WriteEndObject(); }));
    }
    private static async ValueTask<Result<ApiReply>> Mutation(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input, bool delete)
    {
        var fields = Validation.Fields(input, ["expectedRevision"]); if (!fields.IsSuccess) return Result<ApiReply>.Fail(fields.Error);
        var revision = Validation.Integer(input.GetProperty("expectedRevision")); if (!revision.IsSuccess) return Result<ApiReply>.Fail(revision.Error);
        var ports = Ports(context.State, context.Database); var id = parameters["publicationId"];
        return delete ? Replies.Of((await Publications.Delete(ports, context.Actor, id, revision.Value, context.RequestId)).Map(_ => JsonValues.Object(writer => writer.WriteBoolean("deleted", true))))
            : Replies.Of((await Publications.Commit(ports, context.Actor, id, revision.Value, context.RequestId, context.Http.RequestAborted)).Map(Details));
    }
    private static async ValueTask<Result<ApiReply>> Upload(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var request = context.Http.Request;
        if (request.Headers.ContentType.Count != 1 || request.ContentType != "application/octet-stream") return Results.Fail<ApiReply>("invalid", "Expected application/octet-stream");
        if (request.ContentLength is not { } length || length < 0 || request.Headers["Content-Length"].Count != 1 || request.Headers["Content-Length"][0] != length.ToString(System.Globalization.CultureInfo.InvariantCulture)) return Results.Fail<ApiReply>("invalid", "An exact Content-Length is required for binary input");
        if (length > PublicationValues.FileBytes) return Results.Fail<ApiReply>("body_too_large", "Binary request exceeds its operation bound");
        return Replies.Of((await Publications.Upload(Ports(context.State, context.Database), context.Actor, parameters["publicationId"], parameters["fileId"], length, request.Body, context.Http.RequestAborted)).Map(_ => JsonValues.Object(writer => writer.WriteBoolean("uploaded", true))));
    }
    private static void Summary(ProtocolWriter writer, PublicationSummary value)
    {
        var record = value.Record; var publication = record.Publication;
        writer.WriteString("id", publication.Id); writer.WriteString("agentId", publication.AgentId); writer.WriteString("agentName", record.AgentName); writer.WriteString("ownerId", record.OwnerId); writer.WriteString("ownerName", record.OwnerName); writer.WriteString("title", publication.Title); writer.WriteString("state", publication.State);
        writer.WriteNumber("revision", publication.Revision); writer.WriteNumber("createdAt", publication.CreatedAt); writer.WriteNumber("expiresAt", publication.ExpiresAt); JsonValues.Number(writer, "publishedAt", publication.PublishedAt); JsonValues.Number(writer, "deletedAt", publication.DeletedAt);
        writer.WriteNumber("totalBytes", publication.TotalBytes); writer.WriteNumber("fileCount", publication.FileCount); writer.WriteString("url", value.Url); JsonValues.Strings(writer, "allowedActions", value.AllowedActions);
    }
    private static JsonElement Details(PublicationDetails value) => JsonValues.Object(writer =>
    {
        Summary(writer, value.Summary); writer.WriteStartArray("files");
        foreach (var file in value.Files)
        { writer.WriteStartObject(); writer.WriteString("id", file.Id); writer.WriteString("path", file.Manifest.Path); writer.WriteString("mediaType", file.Manifest.MediaType); writer.WriteNumber("bytes", file.Manifest.Bytes); writer.WriteString("sha256", file.Manifest.Sha256); writer.WriteBoolean("uploaded", file.Uploaded); writer.WriteEndObject(); }
        writer.WriteEndArray();
    });
}
