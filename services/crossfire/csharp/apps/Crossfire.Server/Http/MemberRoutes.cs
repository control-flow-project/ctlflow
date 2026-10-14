using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class MemberRoutes
{
    public static IReadOnlyList<ApiEndpoint> Endpoints() =>
    [
        new("members", (context, parameters, input) =>
        {
            var page = Transport.Page(context.Query);
            return Replies.Ready(page.IsSuccess ? Replies.Paged(Members.List(MemberCommands.Ports(context.Database, context.State.Now), context.Actor, page.Value.Page, page.Value.PageSize), context.RequestId, JsonValues.Member)
                : Result<ApiReply>.Fail(page.Error));
        }, QueryFields: ["page", "pageSize"]),
        new("member", (context, parameters, input) => Replies.Ready(Member(Members.Read(MemberCommands.Ports(context.Database, context.State.Now), context.Actor, parameters["memberId"])))),
        new("changeMember", (context, parameters, input) => Change(context, parameters, input, false)),
        new("memberRole", (context, parameters, input) => Change(context, parameters, input, true))
    ];

    private static Result<ApiReply> Member(Result<MemberView> value)
        => Replies.Of(value.Map(member => JsonValues.Value(writer => JsonValues.Member(writer, member))));

    private static ValueTask<Result<ApiReply>> Change(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input, bool role)
    {
        var parsed = Inputs.MemberChange(input, role);
        return Replies.Ready(parsed.IsSuccess ? Member(Members.Change(MemberCommands.Ports(context.Database, context.State.Now), context.Actor, parameters["memberId"], parsed.Value, context.RequestId))
            : Result<ApiReply>.Fail(parsed.Error));
    }
}
