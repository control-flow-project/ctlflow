using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class InvitationRoutes
{
    public static IReadOnlyList<ApiEndpoint> Endpoints() =>
    [
        new("createInvitation", Create),
        new("invitations", (context, parameters, input) =>
        {
            var page = Transport.Page(context.Query);
            return Replies.Ready(page.IsSuccess ? Replies.Paged(Invitations.List(InvitationCommands.Ports(context.Database, context.State.Now), context.Actor, page.Value.Page, page.Value.PageSize), context.RequestId, View)
                : Result<ApiReply>.Fail(page.Error));
        }, QueryFields: ["page", "pageSize"]),
        new("invitation", (context, parameters, input) => Replies.Ready(Replies.Of(Invitations.Read(InvitationCommands.Ports(context.Database, context.State.Now), context.Actor, parameters["invitationId"])
            .Map(value => JsonValues.Value(writer => View(writer, value)))))),
        new("revokeInvitation", (context, parameters, input) => Replies.Ready(Validation.Fields(input, []).IsSuccess
            ? Replies.Acknowledge(Invitations.Revoke(InvitationCommands.Ports(context.Database, context.State.Now), context.Actor, parameters["invitationId"], context.RequestId))
            : Results.Fail<ApiReply>("invalid", "Expected an empty object"))),
        new("claimInvitation", Claim)
    ];

    public static void View(ProtocolWriter writer, MemberInvitation value)
    {
        writer.WriteStartObject(); writer.WriteString("invitationId", value.Id); writer.WriteString("createdByMemberId", value.CreatedByMemberId); writer.WriteString("roleCode", value.RoleCode);
        writer.WriteNumber("createdAt", value.CreatedAt); writer.WriteNumber("expiresAt", value.ExpiresAt); writer.WriteString("consumedByMemberId", value.ConsumedByMemberId);
        JsonValues.Number(writer, "revokedAt", value.RevokedAt); writer.WriteEndObject();
    }

    private static ValueTask<Result<ApiReply>> Create(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["roleCode", "expiresSeconds"]);
        if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var role = Validation.Choice(input.GetProperty("roleCode"), "member", "administrator"); var lifetime = Validation.Integer(input.GetProperty("expiresSeconds"), 60, 604800);
        if (!role.IsSuccess || !lifetime.IsSuccess) return Replies.Ready(Results.Fail<ApiReply>("invalid", "Invalid invitation role or lifetime"));
        return Replies.Ready(Replies.Of(Invitations.Create(InvitationCommands.Ports(context.Database, context.State.Now), context.Actor, role.Value, lifetime.Value, context.RequestId)
            .Map(value => JsonValues.Object(writer =>
            {
                writer.WriteString("invitationId", value.InvitationId); writer.WriteString("claimSecret", value.ClaimSecret); writer.WriteNumber("expiresAt", value.ExpiresAt);
                writer.WriteString("signupUrl", context.State.Configuration.PublicOrigin + "/manage/join/" + value.InvitationId + "#" + value.ClaimSecret);
            }))));
    }

    private static ValueTask<Result<ApiReply>> Claim(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        if (context.Http.Request.Headers.Origin != context.State.Configuration.PublicOrigin) return Replies.Ready(Results.Fail<ApiReply>("forbidden", "Same-origin invitation claim required"));
        var fields = Validation.Fields(input, ["claimSecret"]);
        if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var secret = Inputs.Secret(input, "claimSecret");
        if (!secret.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(secret.Error));
        var verified = Invitations.Verify(InvitationCommands.Ports(context.Database, context.State.Now), parameters["invitationId"], secret.Value);
        if (!verified.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(verified.Error));
        InvitationCookies.Set(context.Http.Response, parameters["invitationId"] + "." + secret.Value);
        return Replies.Ready(Result<ApiReply>.Success(new(JsonValues.Accepted())));
    }
}
