using System.Text.Json;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class InstanceRoutes
{
    public static IReadOnlyList<ApiEndpoint> Endpoints() =>
    [
        new("messagingBackend", (context, parameters, input) => Replies.Ready(Result<ApiReply>.Success(new(MessagingJson.Description(context.State.Messaging.Describe(context.State.Configuration.PublicOrigin)))))),
        new("authenticateBackend", AuthenticateBackend),
        new("release", (context, parameters, input) => Replies.Ready(Result<ApiReply>.Success(new(context.State.Release.Manifest)))),
        new("health", (context, parameters, input) => Replies.Ready(Result<ApiReply>.Success(new(JsonValues.Object(writer =>
        {
            writer.WriteString("instance", context.State.Configuration.Instance); writer.WriteString("release", context.State.Release.Identity); writer.WriteString("version", context.State.Release.Version);
            writer.WriteNumber("startedAt", context.State.StartedAt); writer.WriteNumber("loggingRetentionDays", context.State.Configuration.LoggingRetentionDays); writer.WriteString("loggingError", context.State.Diagnostics.Error);
        }))))),
        new("registrationPolicy", (context, parameters, input) =>
        {
            var policy = PolicyQueries.Find(context.Database);
            return Replies.Ready(policy.IsSuccess && policy.Value is null ? Results.Fail<ApiReply>("unavailable", "Instance policy unavailable")
                : Replies.Of(policy.Map(value => JsonValues.Object(writer => writer.WriteString("signupMode", value!.SignupMode)))));
        }),
        new("policy", (context, parameters, input) => Replies.Ready(Replies.Of(Policies.Read(PolicyCommands.Ports(context.Database, context.State.Now), context.Actor).Map(View)))),
        new("changePolicy", Change)
    ];

    private static async ValueTask<Result<ApiReply>> AuthenticateBackend(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        if (context.Http.Request.Headers.Origin != context.State.Configuration.PublicOrigin) return Results.Fail<ApiReply>("forbidden", "Invalid request origin");
        if (!Validation.Fields(input, ["username", "password"]).IsSuccess) return Results.Fail<ApiReply>("invalid", "Invalid messaging sign-in");
        var username = Validation.Text(input.GetProperty("username"), 255); var password = Validation.Text(input.GetProperty("password"), 1024);
        if (!username.IsSuccess || !password.IsSuccess) return Results.Fail<ApiReply>("invalid", "Invalid messaging sign-in");
        return Replies.Of((await context.State.Messaging.Authenticate(username.Value, password.Value, context.Http.RequestAborted)).Map(token => WireJson.Object(writer => writer.WriteString("accessToken", token))));
    }

    public static JsonElement View(InstancePolicy value) => JsonValues.Object(writer =>
    {
        writer.WriteNumber("revision", value.Revision); writer.WriteNumber("maxOwnerAgents", value.MaxOwnerAgents); writer.WriteNumber("maxAgents", value.MaxAgents);
        writer.WriteNumber("maxPending", value.MaxPending); writer.WriteNumber("maxMessageBytes", value.MaxMessageBytes); writer.WriteNumber("fleetIdleTimeoutSeconds", value.FleetIdleTimeoutSeconds);
        writer.WriteNumber("enrollmentSeconds", value.EnrollmentSeconds); writer.WriteNumber("reconcileSeconds", value.ReconcileSeconds); writer.WriteString("agentInstructions", value.AgentInstructions);
        writer.WriteString("signupMode", value.SignupMode); writer.WriteString("invitationIssuers", value.InvitationIssuers);
    });

    private static ValueTask<Result<ApiReply>> Change(ApiContext context, IReadOnlyDictionary<string, string> parameters, JsonElement input)
    {
        var fields = Validation.Fields(input, ["expectedRevision", "maxOwnerAgents", "maxAgents", "maxPending", "maxMessageBytes", "fleetIdleTimeoutSeconds", "enrollmentSeconds", "reconcileSeconds",
            "agentInstructions", "signupMode", "invitationIssuers"]);
        if (!fields.IsSuccess) return Replies.Ready(Result<ApiReply>.Fail(fields.Error));
        var revision = Validation.Integer(input.GetProperty("expectedRevision")); var ownerAgents = Validation.Integer(input.GetProperty("maxOwnerAgents"), 1, 100);
        var agents = Validation.Integer(input.GetProperty("maxAgents"), 1, 1000); var pending = Validation.Integer(input.GetProperty("maxPending"), 1, 1000);
        var size = Validation.Integer(input.GetProperty("maxMessageBytes"), 4096, 4194304); var idle = Validation.Integer(input.GetProperty("fleetIdleTimeoutSeconds"), 0, 604800);
        var enrollment = Validation.Integer(input.GetProperty("enrollmentSeconds"), 60, 3600); var reconcile = Validation.Integer(input.GetProperty("reconcileSeconds"), 30, 3600);
        var instructions = Validation.PlainText(input.GetProperty("agentInstructions"), 8192); var signup = Validation.Choice(input.GetProperty("signupMode"), "invitation", "open");
        var issuers = Validation.Choice(input.GetProperty("invitationIssuers"), "administrators", "members");
        if (!revision.IsSuccess || !ownerAgents.IsSuccess || !agents.IsSuccess || !pending.IsSuccess || !size.IsSuccess || !idle.IsSuccess || !enrollment.IsSuccess
            || !reconcile.IsSuccess || !instructions.IsSuccess || !signup.IsSuccess || !issuers.IsSuccess) return Replies.Ready(Results.Fail<ApiReply>("invalid", "Invalid bounded instance policy"));
        var value = new InstancePolicy("instance", revision.Value, ownerAgents.Value, agents.Value, pending.Value, enrollment.Value, reconcile.Value,
            size.Value, idle.Value, instructions.Value, signup.Value, issuers.Value);
        var ports = PolicyCommands.Ports(context.Database, context.State.Now);
        var changed = Policies.Change(ports, context.Actor, value, revision.Value, context.RequestId);
        return Replies.Ready(changed.IsSuccess ? Replies.Of(Policies.Read(ports, context.Actor).Map(View)) : Result<ApiReply>.Fail(changed.Error));
    }
}
