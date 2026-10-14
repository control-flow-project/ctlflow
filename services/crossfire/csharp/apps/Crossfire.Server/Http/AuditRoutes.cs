using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class AuditRoutes
{
    public static IReadOnlyList<ApiEndpoint> Endpoints() => [new("audit", List, ["page", "pageSize", "ownerId"])];
    private static ValueTask<Result<ApiReply>> List(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var page = Transport.Page(context.Query); var owner = context.Query.GetValueOrDefault("ownerId");
        if (!page.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(page.Error));
        if (owner is not null && !Validation.Identifier(owner)) return Replies.Ready(Results.Fail<ApiReply>("invalid", "Invalid audit owner"));
        return Replies.Ready(Replies.Paged(AuditReads.List(AuditQueries.Ports(context.Database, context.State.Now), context.Actor, owner, page.Value.Page, page.Value.PageSize), context.RequestId, View));
    }

    private static void View(ProtocolWriter writer, AuditDetails value)
    {
        var entry = value.Event; var intent = entry.Intent;
        writer.WriteStartObject(); writer.WritePropertyName("actor"); if (value.Actor is null) writer.WriteNullValue(); else DiscoveryViews.Principal(writer, value.Actor);
        writer.WritePropertyName("target"); if (value.Target is null) writer.WriteNullValue(); else DiscoveryViews.Principal(writer, value.Target);
        writer.WriteString("auditId", entry.Id); writer.WriteString("requestId", intent.RequestId); writer.WriteString("actorCredentialId", intent.ActorCredentialId); writer.WriteString("actorKind", intent.ActorKind);
        writer.WriteString("actorPrincipalId", intent.ActorPrincipalId); writer.WriteString("ownerId", intent.OwnerId); writer.WriteString("targetKind", intent.TargetKind); writer.WriteString("targetId", intent.TargetId);
        writer.WriteString("roomId", intent.RoomId); writer.WriteString("membershipGeneration", intent.MembershipGeneration); writer.WriteString("authorizerId", intent.AuthorizerId); writer.WriteString("addedById", intent.AddedById);
        writer.WriteString("permissionCode", intent.PermissionCode); writer.WriteString("action", intent.Action); writer.WriteString("outcome", intent.Outcome); writer.WriteString("message", intent.Message); writer.WriteNumber("createdAt", entry.CreatedAt); writer.WriteEndObject();
    }
}
