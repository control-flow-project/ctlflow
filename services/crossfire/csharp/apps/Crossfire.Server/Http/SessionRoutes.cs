using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class SessionRoutes
{
    public static IReadOnlyList<ApiEndpoint> Endpoints() =>
    [
        new("createSession", Create),
        new("currentSession", (context, parameters, input) => Replies.Ready(context.Session is null
            ? Results.Fail<ApiReply>("unauthorized", "Management session required")
            : Result<ApiReply>.Success(new(View(context.Session.Member, context.Session.CsrfSecret, context.Session.Permissions))))),
        new("endSession", (context, parameters, input) => Replies.Ready(Validation.Fields(input, []).IsSuccess
            ? Sessions.End(context.Sessions, context.Cookie).Map(_ => new ApiReply(JsonValues.Accepted(), SetCookie: ""))
            : Results.Fail<ApiReply>("invalid", "Expected an empty object")))
    ];

    private static JsonElement View(MemberView member, string csrfSecret, IReadOnlyList<string> permissions) => JsonValues.Object(writer =>
    {
        writer.WritePropertyName("member"); JsonValues.Member(writer, member); writer.WriteString("csrfSecret", csrfSecret); JsonValues.Strings(writer, "permissions", permissions);
    });

    private static async ValueTask<Result<ApiReply>> Create(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        if (context.Http.Request.Headers.Origin != context.State.Configuration.PublicOrigin) return Results.Fail<ApiReply>("forbidden", "Same-origin human login required");
        var fields = Validation.Fields(input, ["nativeAccessToken"]);
        if (!fields.IsSuccess) return Result<ApiReply>.Fail(fields.Error);
        var token = Validation.Text(input.GetProperty("nativeAccessToken"), 8192);
        if (!token.IsSuccess) return Result<ApiReply>.Fail(token.Error);
        var result = await Sessions.Create(context.Sessions, token.Value, context.Http.RequestAborted);
        return result.Map(value => new ApiReply(View(value.Member, value.CsrfSecret, value.Permissions), SetCookie: value.Secret));
    }
}
