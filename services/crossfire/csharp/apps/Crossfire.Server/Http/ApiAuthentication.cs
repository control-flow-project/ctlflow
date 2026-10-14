using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class ApiAuthentication
{
    public static Result<string> Bearer(HttpRequest request)
    {
        var authorization = request.Headers.Authorization;
        return authorization.Count == 1 && authorization[0] is { } value && value.StartsWith("Bearer ", StringComparison.Ordinal)
            && value.Length > 7 && !value[7..].Any(TextRules.WhiteSpace)
            ? Result<string>.Success(value[7..]) : Results.Fail<string>("unauthorized", "Native bearer authentication is required");
    }

    public static async ValueTask<Result<ApiContext>> Authenticate(ApiState state, CrossfireDbContext database, HttpContext http, ApiEndpoint endpoint, string requestId, FleetChanges changes)
    {
        var request = http.Request;
        if (request.Headers.ContainsKey("Authorization") && request.Headers.ContainsKey("Cookie"))
            return Results.Fail<ApiContext>("invalid", "Do not mix cookie and bearer authentication");
        var context = new ApiContext(state, database, http, requestId, null, null, null, Transport.Cookie(request), new Dictionary<string, string>(), changes);
        if (endpoint.Operation.Authentication == "public") return request.Headers.ContainsKey("Authorization")
            ? Results.Fail<ApiContext>("invalid", "This operation does not accept bearer authentication") : Result<ApiContext>.Success(context);
        if (request.Headers.ContainsKey("Authorization"))
        {
            var bearer = Bearer(request);
            if (endpoint.Operation.Authentication == "human" || !bearer.IsSuccess)
                return Results.Fail<ApiContext>("unauthorized", "This operation requires the correct authentication kind");
            if (endpoint.Operation.Authentication == "fleet") return FleetAuthority.Authenticate(FleetCommands.Ports(database, state.Now), bearer.Value).Map(controller => context with { Controller = controller });
            var actor = await NativeActors.Agent(new(context.Authorization, id => MemberQueries.ByMatrixId(database, id), state.Matrix.Identify), bearer.Value, http.RequestAborted);
            return actor.Map(identity => context with { Identity = identity });
        }
        if (endpoint.Operation.Authentication == "agent") return Results.Fail<ApiContext>("unauthorized", "Agent bearer authentication is required");
        var mutation = request.Method != "GET";
        var csrf = request.Headers["X-Crossfire-CSRF"];
        if (mutation && (request.Headers.Origin != state.Configuration.PublicOrigin || csrf.Count != 1))
            return Results.Fail<ApiContext>("forbidden", "Same-origin CSRF-protected mutation required");
        var member = await Sessions.Authenticate(context.Sessions, context.Cookie, mutation ? csrf[0] : null, http.RequestAborted);
        return member.Map(value => context with { Identity = value.Actor, Session = value });
    }
}
