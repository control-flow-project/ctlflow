using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public static class MatrixRoutes
{
    private static Result<string> Bearer(HttpRequest request)
    { var value = request.Headers.Authorization.ToString(); return request.Headers.Authorization.Count == 1 && value.StartsWith("Bearer ", StringComparison.Ordinal) && value.Length is > 7 and <= 8199 ? Result<string>.Success(value[7..]) : Results.Fail<string>("unauthorized", "Native bearer authentication is required"); }
    public static bool Handles(string path, string method)
        => path == "/_matrix/client/v3/user_directory/search" || method == "PUT" && ProfileId(path) is not null;

    public static async Task Handle(MatrixWebServices services, HttpContext http, string path, string requestId)
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
        var bearer = Bearer(http.Request);
        if (!bearer.IsSuccess || bearer.Value.Length == 0)
        {
            await NativeResponses.Error(http, requestId, 401, "M_MISSING_TOKEN", "Native bearer authentication is required"); return;
        }
        var actor = await services.Authenticate(bearer.Value, http.RequestAborted);
        if (!actor.IsSuccess) { await NativeResponses.Reject(http, requestId, actor.Error); return; }
        if (directory) await Directory(services, http, actor.Value, requestId);
        else await Profile(services, http, actor.Value, ProfileId(path)!, requestId);
    }

    private static string? ProfileId(string path)
    {
        const string prefix = "/_matrix/client/v3/profile/", suffix = "/displayname";
        if (!path.StartsWith(prefix, StringComparison.Ordinal) || !path.EndsWith(suffix, StringComparison.Ordinal)) return null;
        var value = path[prefix.Length..^suffix.Length]; if (value.Length == 0 || value.Contains('/')) return null;
        try { return Uri.UnescapeDataString(value); } catch (UriFormatException) { return null; }
    }

    private static async Task Directory(MatrixWebServices services, HttpContext http, Actor actor, string requestId)
    {
        var body = await services.Read(http.Request, 2097152, http.RequestAborted);
        if (!body.IsSuccess) { await NativeResponses.Reject(http, requestId, body.Error); return; }
        var fields = Validation.Fields(body.Value, ["search_term"], ["limit"]);
        var search = fields.IsSuccess ? Validation.Text(body.Value.GetProperty("search_term"), 200, 0) : Result<string>.Fail(fields.Error);
        var limit = body.Value.ValueKind == System.Text.Json.JsonValueKind.Object && body.Value.TryGetProperty("limit", out var value) ? Validation.Integer(value, 0, 100) : Result<long>.Success(10);
        if (!search.IsSuccess || !limit.IsSuccess) { await NativeResponses.Reject(http, requestId, !search.IsSuccess ? search.Error : limit.Error); return; }
        var found = services.Search(actor, search.Value, Math.Max(1, (int)limit.Value));
        if (!found.IsSuccess) { await NativeResponses.Reject(http, requestId, found.Error); return; }
        var selected = found.Value.Items.Take((int)limit.Value).ToArray();
        await NativeResponses.Send(http, requestId, 200, WireJson.Object(writer =>
        {
            writer.WritePropertyName("results"); WireJson.Array(selected, (output, principal) =>
            { output.WriteStartObject(); output.WriteString("user_id", principal.BackendUserId); output.WriteString("display_name", principal.DisplayName); output.WriteEndObject(); }).WriteTo(writer);
            writer.WriteBoolean("limited", found.Value.TotalItems > selected.Length);
        }));
    }

    private static async Task Profile(MatrixWebServices services, HttpContext http, Actor actor, string userId, string requestId)
    {
        if (actor.Kind == "agent") { await NativeResponses.Error(http, requestId, 403, "M_FORBIDDEN", "Agent names are registered through owner-reviewed fleet enrollment"); return; }
        var body = await services.Read(http.Request, 2097152, http.RequestAborted);
        var fields = body.IsSuccess ? Validation.Fields(body.Value, ["displayname"]) : Result<System.Text.Json.JsonElement>.Fail(body.Error);
        var name = fields.IsSuccess ? Validation.Text(body.Value.GetProperty("displayname"), 100) : Result<string>.Fail(fields.Error);
        if (!name.IsSuccess) { await NativeResponses.Error(http, requestId, name.Error.Code == "body_too_large" ? 413 : 400, "M_INVALID_PARAM", name.Error.Message); return; }
        var changed = await services.ChangeName(actor, userId, name.Value, requestId, http.RequestAborted);
        if (!changed.IsSuccess) { await NativeResponses.Reject(http, requestId, changed.Error); return; }
        await NativeResponses.Send(http, requestId, 200, WireJson.Object(_ => { }));
    }
}
