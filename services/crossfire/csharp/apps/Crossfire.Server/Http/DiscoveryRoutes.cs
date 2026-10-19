using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class DiscoveryRoutes
{
    public static IReadOnlyList<ApiEndpoint> Endpoints() =>
    [
        new("principals", Principals, QueryFields: ["page", "pageSize", "kind", "search", "excludeId"]),
        new("resolvePrincipals", Resolve),
        new("roles", (context, parameters, input) => Replies.Ready(Replies.Of(Discovery.Roles(DiscoveryQueries.Ports(context.Database, context.State.Now), context.Actor)
            .Map(values => JsonValues.Array(values, (writer, value) =>
            {
                writer.WriteStartObject(); writer.WriteString("code", value.Code); writer.WriteString("principalKind", value.PrincipalKind); writer.WriteString("label", value.Label); writer.WriteEndObject();
            }))))),
        new("permissions", (context, parameters, input) => Replies.Ready(Replies.Of(Discovery.Permissions(DiscoveryQueries.Ports(context.Database, context.State.Now), context.Actor)
            .Map(values => JsonValues.Array(values, (writer, value) =>
            {
                writer.WriteStartObject(); writer.WriteString("code", value.Code); writer.WriteString("grantScope", value.GrantScope); writer.WriteString("description", value.Description); writer.WriteEndObject();
            })))))
    ];

    private static ValueTask<Result<ApiReply>> Principals(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var page = Transport.Page(context.Query);
        if (!page.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(page.Error));
        var exclude = context.Query.GetValueOrDefault("excludeId");
        if (exclude is not null && !Validation.Identifier(exclude)) return Replies.Ready(Results.Fail<ApiReply>("invalid", "Invalid excluded identity"));
        var request = new DiscoveryRequest(page.Value.Page, page.Value.PageSize, context.Query.GetValueOrDefault("kind", "all"), context.Query.GetValueOrDefault("search", ""), exclude);
        return Replies.Ready(Replies.Paged(Discovery.Principals(DiscoveryQueries.Ports(context.Database, context.State.Now), context.Actor, request), context.RequestId, DiscoveryViews.Principal));
    }

    private static ValueTask<Result<ApiReply>> Resolve(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["backendUserIds"]);
        if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var ids = Validation.List(input.GetProperty("backendUserIds"), value => Validation.Text(value), 100, 1);
        if (!ids.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(ids.Error));
        return Replies.Ready(Replies.Of(Discovery.Resolve(DiscoveryQueries.Ports(context.Database, context.State.Now), context.Actor, ids.Value).Map(values => JsonValues.Array(values, (writer, value) =>
        {
            writer.WriteStartObject(); writer.WriteString("backendUserId", value.BackendUserId); writer.WriteString("kind", value.Kind); writer.WriteString("ownerBackendUserId", value.OwnerBackendUserId);
            writer.WriteString("displayName", value.DisplayName); writer.WriteString("ownerDisplayName", value.OwnerDisplayName); writer.WriteEndObject();
        }))));
    }
}
