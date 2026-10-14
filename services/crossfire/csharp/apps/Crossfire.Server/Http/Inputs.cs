using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class Inputs
{
    public static Result<string> Id(JsonElement input, string name)
    {
        var text = Validation.Text(input.GetProperty(name));
        return text.IsSuccess && Validation.Identifier(text.Value) ? text : Results.Fail<string>("invalid", "Invalid " + name);
    }

    public static Result<string> Secret(JsonElement input, string name)
    {
        var text = Validation.Text(input.GetProperty(name), 43, 43);
        return text.IsSuccess && Validation.Secret(text.Value) ? text : Results.Fail<string>("invalid", "Invalid " + name);
    }

    public static Result<string> Name(JsonElement input, string name)
    {
        var text = Validation.Text(input.GetProperty(name), 40);
        return text.IsSuccess && Validation.Name(text.Value) ? text : Results.Fail<string>("invalid", "Invalid " + name);
    }

    public static Result<ControllerDescription> Controller(JsonElement input)
    {
        var fields = Validation.Fields(input, ["name"], ["metadata"]);
        if (!fields.IsSuccess) return Result<ControllerDescription>.Fail(fields.Error);
        var name = Validation.Text(input.GetProperty("name"), 100);
        if (!name.IsSuccess) return Result<ControllerDescription>.Fail(name.Error);
        var metadata = new Dictionary<string, string>(StringComparer.Ordinal);
        if (input.TryGetProperty("metadata", out var values))
        {
            if (values.ValueKind != JsonValueKind.Object || values.EnumerateObject().Count() > 16) return Results.Fail<ControllerDescription>("invalid", "Controller metadata supports at most 16 text fields");
            foreach (var entry in values.EnumerateObject())
            {
                var value = Validation.Text(entry.Value, 256, 0);
                if (!Validation.Name(entry.Name) || !value.IsSuccess) return Results.Fail<ControllerDescription>("invalid", "Invalid controller metadata");
                metadata[entry.Name] = value.Value;
            }
        }
        return Result<ControllerDescription>.Success(new(name.Value, metadata));
    }

    public static Result<CoordinationPolicy> CoordinationPolicy(JsonElement input)
    {
        var fields = Validation.Fields(input, ["wakeMode", "senders", "permissions"]);
        if (!fields.IsSuccess) return Result<CoordinationPolicy>.Fail(fields.Error);
        var mode = Validation.Choice(input.GetProperty("wakeMode"), "humans", "everyone", "selected");
        if (!mode.IsSuccess) return Result<CoordinationPolicy>.Fail(mode.Error);
        var senders = Validation.List(input.GetProperty("senders"), Sender, 2000);
        if (!senders.IsSuccess) return Result<CoordinationPolicy>.Fail(senders.Error);
        var permissions = Validation.List(input.GetProperty("permissions"), value => Validation.Choice(value, "room.agent.invite"), 1);
        return permissions.Map(value => new CoordinationPolicy(mode.Value, senders.Value, value));
    }

    private static Result<MatrixWakeSender> Sender(JsonElement input)
    {
        var fields = Validation.Fields(input, ["matrixUserId", "includeAgents"]);
        if (!fields.IsSuccess) return Result<MatrixWakeSender>.Fail(fields.Error);
        var id = Validation.Text(input.GetProperty("matrixUserId"));
        if (!id.IsSuccess || !Validation.UserId(id.Value)) return Results.Fail<MatrixWakeSender>("invalid", "Invalid Matrix user ID");
        return Validation.Boolean(input.GetProperty("includeAgents")).Map(include => new MatrixWakeSender(id.Value, include));
    }

    private static Result<RosterInstance> Instance(JsonElement input)
    {
        var fields = Validation.Fields(input, ["instanceKey", "name", "coordinationPolicy"], ["identity"]);
        if (!fields.IsSuccess) return Result<RosterInstance>.Fail(fields.Error);
        var key = Name(input, "instanceKey"); var name = Name(input, "name"); var policy = CoordinationPolicy(input.GetProperty("coordinationPolicy"));
        if (!key.IsSuccess) return Result<RosterInstance>.Fail(key.Error);
        if (!name.IsSuccess) return Result<RosterInstance>.Fail(name.Error);
        if (!policy.IsSuccess) return Result<RosterInstance>.Fail(policy.Error);
        string? agentId = null; string? accessToken = null;
        if (input.TryGetProperty("identity", out var identity))
        {
            fields = Validation.Fields(identity, ["agentId", "accessToken"]);
            if (!fields.IsSuccess) return Result<RosterInstance>.Fail(fields.Error);
            var id = Id(identity, "agentId"); var token = Validation.Text(identity.GetProperty("accessToken"), 8192);
            if (!id.IsSuccess) return Result<RosterInstance>.Fail(id.Error);
            if (!token.IsSuccess) return Result<RosterInstance>.Fail(token.Error);
            agentId = id.Value; accessToken = token.Value;
        }
        return Result<RosterInstance>.Success(new(key.Value, name.Value, agentId, policy.Value, accessToken));
    }

    public static Result<EnrollmentRoster> Roster(JsonElement input, bool introduction)
    {
        string[] required = introduction ? ["controller", "ownerMatrixId", "fleetKey", "instances", "enrollmentId", "claimSecret"] : ["controller", "ownerMatrixId", "fleetKey", "instances"];
        var fields = Validation.Fields(input, required, ["controllerCredential"]);
        if (!fields.IsSuccess) return Result<EnrollmentRoster>.Fail(fields.Error);
        var controller = Controller(input.GetProperty("controller")); var owner = Validation.Text(input.GetProperty("ownerMatrixId")); var key = Name(input, "fleetKey");
        if (!controller.IsSuccess) return Result<EnrollmentRoster>.Fail(controller.Error);
        if (!owner.IsSuccess || !Validation.UserId(owner.Value)) return Results.Fail<EnrollmentRoster>("invalid", "Invalid Matrix owner ID");
        if (!key.IsSuccess) return Result<EnrollmentRoster>.Fail(key.Error);
        var instances = Validation.List(input.GetProperty("instances"), Instance, 100, 1);
        if (!instances.IsSuccess) return Result<EnrollmentRoster>.Fail(instances.Error);
        string? credential = null;
        if (input.TryGetProperty("controllerCredential", out var token))
        {
            var parsed = Validation.Text(token, 200);
            if (!parsed.IsSuccess) return Result<EnrollmentRoster>.Fail(parsed.Error);
            credential = parsed.Value;
        }
        var roster = new EnrollmentRoster(owner.Value, key.Value, controller.Value, instances.Value, credential);
        return EnrollmentValidation.Roster(roster).Map(_ => roster);
    }

    public static Result<EnrollmentIntroduction> Introduction(JsonElement input)
    {
        var roster = Roster(input, true);
        if (!roster.IsSuccess) return Result<EnrollmentIntroduction>.Fail(roster.Error);
        var id = Id(input, "enrollmentId"); var secret = Secret(input, "claimSecret");
        return !id.IsSuccess ? Result<EnrollmentIntroduction>.Fail(id.Error) : secret.Map(value => new EnrollmentIntroduction(id.Value, value, roster.Value));
    }

    public static Result<MemberChange> MemberChange(JsonElement input, bool role)
    {
        var fields = Validation.Fields(input, role ? ["expectedRevision", "roleCode"] : ["expectedRevision"], role ? [] : ["status", "displayName"]);
        if (!fields.IsSuccess) return Result<MemberChange>.Fail(fields.Error);
        var revision = Validation.Integer(input.GetProperty("expectedRevision"));
        if (!revision.IsSuccess) return Result<MemberChange>.Fail(revision.Error);
        string? status = null; string? display = null; string? roleCode = null;
        if (input.TryGetProperty("status", out var requestedStatus))
        {
            var parsed = Validation.Choice(requestedStatus, "active", "suspended", "revoked");
            if (!parsed.IsSuccess) return Result<MemberChange>.Fail(parsed.Error);
            status = parsed.Value;
        }
        if (input.TryGetProperty("displayName", out var requestedDisplay))
        {
            var parsed = Validation.Text(requestedDisplay, 100);
            if (!parsed.IsSuccess) return Result<MemberChange>.Fail(parsed.Error);
            display = parsed.Value;
        }
        if (role)
        {
            var parsed = Validation.Choice(input.GetProperty("roleCode"), "member", "administrator");
            if (!parsed.IsSuccess) return Result<MemberChange>.Fail(parsed.Error);
            roleCode = parsed.Value;
        }
        return Result<MemberChange>.Success(new(revision.Value, status, display, roleCode));
    }
}
