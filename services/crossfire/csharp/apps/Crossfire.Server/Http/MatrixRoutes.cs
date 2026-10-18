using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class MatrixRoutes
{
    public static bool Handles(string path, string method)
        => path == "/_matrix/client/v3/user_directory/search" || method == "PUT" && ProfileId(path) is not null;

    public static async Task Handle(ApiState state, HttpContext http, string path, string requestId)
    {
        var directory = path == "/_matrix/client/v3/user_directory/search";
        if (directory && http.Request.Method != "POST")
        {
            http.Response.Headers.Allow = "POST"; await NativeResponses.Error(http, requestId, 405, "M_UNRECOGNIZED", "Use POST"); return;
        }
        if (http.Request.Query.Count != 0)
        {
            await NativeResponses.Error(http, requestId, 400, "M_INVALID_PARAM", directory ? "Search parameters belong in the request body" : "Use native bearer authentication without query credentials"); return;
        }
        var bearer = ApiAuthentication.Bearer(http.Request);
        if (!bearer.IsSuccess || bearer.Value.Length == 0)
        {
            await NativeResponses.Error(http, requestId, 401, "M_MISSING_TOKEN", "Native bearer authentication is required"); return;
        }
        using var database = state.Storage.Open();
        var actor = await NativeActors.Principal(new(AuthorizationQueries.Ports(database, state.Now), id => MemberQueries.ByMatrixId(database, id), state.Matrix.Identify), bearer.Value, http.RequestAborted);
        if (!actor.IsSuccess) { await NativeResponses.Reject(http, requestId, actor.Error); return; }
        if (directory) await Directory(state, database, http, actor.Value, requestId);
        else await Profile(state, database, http, actor.Value, ProfileId(path)!, requestId);
    }

    private static string? ProfileId(string path)
    {
        var matched = ApiPipeline.Match("/_matrix/client/v3/profile/{userId}/displayname", path);
        return matched?.GetValueOrDefault("userId");
    }

    private static async Task Directory(ApiState state, CrossfireDbContext database, HttpContext http, Actor actor, string requestId)
    {
        var body = await Transport.Read(http.Request, 2097152, http.RequestAborted);
        if (!body.IsSuccess) { await NativeResponses.Reject(http, requestId, body.Error); return; }
        var fields = Validation.Fields(body.Value, ["search_term"], ["limit"]);
        var search = fields.IsSuccess ? Validation.Text(body.Value.GetProperty("search_term"), 200, 0) : Result<string>.Fail(fields.Error);
        var limit = body.Value.ValueKind == System.Text.Json.JsonValueKind.Object && body.Value.TryGetProperty("limit", out var value) ? Validation.Integer(value, 0, 100) : Result<long>.Success(10);
        if (!search.IsSuccess || !limit.IsSuccess) { await NativeResponses.Reject(http, requestId, !search.IsSuccess ? search.Error : limit.Error); return; }
        var found = Discovery.Principals(DiscoveryQueries.Ports(database, state.Now), actor, new(1, Math.Max(1, (int)limit.Value), "all", search.Value));
        if (!found.IsSuccess) { await NativeResponses.Reject(http, requestId, found.Error); return; }
        var selected = found.Value.Items.Take((int)limit.Value).ToArray();
        await NativeResponses.Send(http, requestId, 200, JsonValues.Object(writer =>
        {
            writer.WritePropertyName("results"); JsonValues.Array(selected, (output, principal) =>
            { output.WriteStartObject(); output.WriteString("user_id", principal.MatrixUserId); output.WriteString("display_name", principal.DisplayName); output.WriteEndObject(); }).WriteTo(writer);
            writer.WriteBoolean("limited", found.Value.TotalItems > selected.Length);
        }));
    }

    private static async Task Profile(ApiState state, CrossfireDbContext database, HttpContext http, Actor actor, string userId, string requestId)
    {
        if (actor.Kind == "agent") { await NativeResponses.Error(http, requestId, 403, "M_FORBIDDEN", "Agent names are registered through owner-reviewed fleet enrollment"); return; }
        var member = MemberQueries.Find(database, actor.PrincipalId);
        if (!member.IsSuccess || member.Value is null) { await NativeResponses.Error(http, requestId, 503, "M_UNKNOWN", "Registered profile unavailable"); return; }
        if (userId != member.Value.Principal.MatrixUserId) { await NativeResponses.Error(http, requestId, 403, "M_FORBIDDEN", "You can only change your own profile"); return; }
        var body = await Transport.Read(http.Request, 2097152, http.RequestAborted);
        var fields = body.IsSuccess ? Validation.Fields(body.Value, ["displayname"]) : Result<System.Text.Json.JsonElement>.Fail(body.Error);
        var name = fields.IsSuccess ? Validation.Text(body.Value.GetProperty("displayname"), 100) : Result<string>.Fail(fields.Error);
        if (!name.IsSuccess) { await NativeResponses.Error(http, requestId, name.Error.Code == "body_too_large" ? 413 : 400, "M_INVALID_PARAM", name.Error.Message); return; }
        var changed = Members.Change(MemberCommands.Ports(database, state.Now), actor, actor.PrincipalId, new(member.Value.Principal.Revision, DisplayName: name.Value), requestId);
        if (!changed.IsSuccess) { await NativeResponses.Error(http, requestId, changed.Error.Code == "conflict" ? 409 : 403, "M_FORBIDDEN", changed.Error.Message); return; }
        var applied = await PrincipalApplications.Reconcile(PrincipalApplicationCommands.Ports(database, state.Now, state.Matrix.Ports(), state.Matrix.RoomOperation), actor.PrincipalId, http.RequestAborted);
        if (!applied.IsSuccess) { await NativeResponses.Error(http, requestId, 502, "M_UNKNOWN", applied.Error.Message); return; }
        await NativeResponses.Send(http, requestId, 200, JsonValues.Object(_ => { }));
    }
}
