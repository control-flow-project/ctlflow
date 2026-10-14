using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class EnrollmentRoutes
{
    public static IReadOnlyList<ApiEndpoint> Endpoints() =>
    [
        new("preflight", Preflight),
        new("introduceEnrollment", Introduce),
        new("enrollments", List, QueryFields: ["page", "pageSize", "ownerId"]),
        new("enrollment", (context, parameters, input) =>
            Replies.Ready(Replies.Of(EnrollmentRequests.Read(context.Enrollments, context.Actor, parameters["enrollmentId"]).Map(value => JsonValues.Value(writer => EnrollmentViews.Review(writer, value)))))),
        new("decideEnrollment", Decide),
        new("exchangeEnrollment", Exchange)
    ];

    private static async ValueTask<Result<ApiReply>> Preflight(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var roster = Inputs.Roster(input, false);
        if (!roster.IsSuccess) return Result<ApiReply>.Fail(roster.Error);
        var result = await EnrollmentAdmission.Preflight(context.Enrollments.Admission, roster.Value, context.Http.RequestAborted);
        return Replies.Of(result.Map(count => JsonValues.Object(writer => { writer.WriteBoolean("available", true); writer.WriteNumber("instances", count); })));
    }

    private static async ValueTask<Result<ApiReply>> Introduce(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var parsed = Inputs.Introduction(input);
        if (!parsed.IsSuccess) return Result<ApiReply>.Fail(parsed.Error);
        var result = await EnrollmentRequests.Introduce(context.Enrollments, parsed.Value, context.Http.RequestAborted);
        return Replies.Of(result.Map(value => JsonValues.Object(writer =>
        {
            writer.WritePropertyName("enrollment"); EnrollmentViews.Review(writer, value);
            writer.WriteString("approvalUrl", context.State.Configuration.PublicOrigin + "/manage/enrollments/" + value.Request.Id);
        })));
    }

    private static ValueTask<Result<ApiReply>> Decide(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["expectedRevision", "decision", "verificationCode"]);
        if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var revision = Validation.Integer(input.GetProperty("expectedRevision")); var decision = Validation.Choice(input.GetProperty("decision"), "approve", "reject");
        var verification = Validation.Text(input.GetProperty("verificationCode"), 12, 12);
        if (!revision.IsSuccess || !decision.IsSuccess || !verification.IsSuccess) return Replies.Ready(Results.Fail<ApiReply>("invalid", "Invalid reviewed enrollment decision"));
        var result = EnrollmentDecisions.Decide(context.Enrollments, context.Actor, parameters["enrollmentId"], new(revision.Value, decision.Value, verification.Value), context.RequestId);
        return Replies.Ready(Replies.Of(result.Map(value => JsonValues.Object(writer =>
        {
            writer.WriteString("enrollmentId", value.EnrollmentId); writer.WriteString("status", value.Status); writer.WriteNumber("revision", value.Revision);
        }))));
    }

    private static ValueTask<Result<ApiReply>> Exchange(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["claimSecret"]);
        if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var secret = Inputs.Secret(input, "claimSecret");
        return Replies.Ready(secret.IsSuccess ? Replies.Of(EnrollmentClaims.Exchange(context.Enrollments, parameters["enrollmentId"], secret.Value).Map(EnrollmentViews.Exchange))
            : Result<ApiReply>.Fail(secret.Error));
    }

    private static ValueTask<Result<ApiReply>> List(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var page = Transport.Page(context.Query);
        if (!page.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(page.Error));
        var selected = context.Query.GetValueOrDefault("ownerId");
        if (selected is not null && !Validation.Identifier(selected)) return Replies.Ready(Results.Fail<ApiReply>("invalid", "Invalid owner ID"));
        var scope = OwnerScopes.Read(context.Authorization, context.Actor, "enrollment.read", selected);
        if (!scope.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(scope.Error));
        var result = EnrollmentQueries.List(context.Database, scope.Value, page.Value.Page, page.Value.PageSize);
        if (!result.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(result.Error));
        var owners = new Dictionary<string, MemberView>(StringComparer.Ordinal);
        foreach (var ownerId in result.Value.Items.Select(value => value.OwnerId).Distinct(StringComparer.Ordinal))
        {
            var member = MemberQueries.Find(context.Database, ownerId);
            if (!member.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(member.Error));
            if (member.Value is null) return Replies.Ready(Results.Fail<ApiReply>("unavailable", "Enrollment owner is unavailable"));
            owners.Add(ownerId, member.Value);
        }
        return Replies.Ready(Replies.Paged(result, context.RequestId, (writer, value) => EnrollmentViews.Overview(writer, value, owners[value.OwnerId])));
    }
}
