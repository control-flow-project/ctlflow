using System.Security.Cryptography;
using System.Text.Json;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Contracts;
using Fleetd.Domain;
using Fleetd.Storage;

namespace Fleetd.AdapterExecution;

public static class Enrollment
{
    public static async ValueTask<Result<Unit>> Prepare(FleetConfiguration configuration, ControllerIdentity controller, string intent,
        Func<string?, Coordination> clients, TimeProvider clock, Action<ApprovalLink> approval, CancellationToken cancellation)
    {
        var loaded = BindingFiles.Load(configuration); if (!loaded.IsSuccess) return Result<Unit>.Fail(loaded.Error); var binding = loaded.Value; var roster = configuration.Roster;
        if (binding.Server != roster.Coordination.Server || binding.Owner != roster.Coordination.Owner || binding.FleetKey != roster.Fleet) return Results.Fail<Unit>("conflict", "Fleet connection differs from its saved identity; it cannot be silently replaced");
        if (intent == "resume" && binding.FleetId is not null && binding.ControllerCredential is not null && roster.Instances.All(instance => binding.Identities.Any(identity => identity.InstanceKey == instance.Key && identity.Name == instance.Name)))
        {
            var client = clients(binding.ControllerCredential); var current = await client.Call(new("fleet", new Dictionary<string, string> { ["fleetId"] = binding.FleetId }), cancellation); if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
            if (WireJson.Text(current.Value, "fleetId") != binding.FleetId || WireJson.Text(current.Value, "fleetKey") != binding.FleetKey || !current.Value.TryGetProperty("owner", out var owner) || WireJson.Text(owner, "backendUserId") != binding.Owner) return Results.Fail<Unit>("conflict", "Approved fleet authority differs from its saved identity");
            var registered = await client.Call(new("fleetAgents", new Dictionary<string, string> { ["fleetId"] = binding.FleetId }, Query: new Dictionary<string, string> { ["page"] = "1", ["pageSize"] = "100" }), cancellation); if (!registered.IsSuccess) return Result<Unit>.Fail(registered.Error);
            if (!registered.Value.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array || items.GetArrayLength() != roster.Instances.Count || !registered.Value.TryGetProperty("meta", out var meta) || meta.GetProperty("page").GetInt64() != 1 || meta.GetProperty("pageSize").GetInt64() != 100 || meta.GetProperty("totalPages").GetInt64() != 1 || meta.GetProperty("totalItems").GetInt64() != items.GetArrayLength()) return Results.Fail<Unit>("conflict", "Approved fleet roster is incomplete or differs from its configured instances");
            var rows = items.EnumerateArray().ToArray(); if (rows.Select(value => WireJson.Text(value, "instanceKey")).Distinct().Count() != rows.Length || rows.Select(value => WireJson.Text(value.GetProperty("agent"), "agentId")).Distinct().Count() != rows.Length) return Results.Fail<Unit>("invalid", "Duplicate approved fleet identity");
            foreach (var instance in roster.Instances)
            {
                var expected = binding.Identities.First(identity => identity.InstanceKey == instance.Key); var selected = rows.FirstOrDefault(value => WireJson.Text(value, "instanceKey") == instance.Key); if (selected.ValueKind != JsonValueKind.Object || !selected.TryGetProperty("agent", out var observed)) return Results.Fail<Unit>("conflict", "Approved instance is missing: " + instance.Key);
                var deployment = observed.GetProperty("deployment"); var principal = observed.GetProperty("owner");
                if (WireJson.Text(observed, "agentId") != expected.AgentId || WireJson.Text(observed, "name") != instance.Name || WireJson.Text(observed, "backendUserId") != expected.Account.UserId || WireJson.Text(deployment, "fleetId") != binding.FleetId || WireJson.Text(deployment, "instanceKey") != instance.Key || WireJson.Text(principal, "backendUserId") != binding.Owner) return Results.Fail<Unit>("conflict", "Approved fleet instance differs from its saved identity: " + instance.Key);
                if (WireJson.Text(observed, "status") != "active" || WireJson.Text(principal, "status") != "active") return Results.Fail<Unit>("forbidden", "Fleet resume requires active existing agent and owner accounts");
            }
            return Results.Done();
        }
        var input = WireJson.Object(writer =>
        {
            writer.WriteString("ownerBackendUserId", binding.Owner); writer.WriteString("fleetKey", binding.FleetKey); writer.WritePropertyName("controller"); FleetWire.Controller(controller).WriteTo(writer); writer.WriteStartArray("instances");
            foreach (var instance in roster.Instances)
            { writer.WriteStartObject(); writer.WriteString("instanceKey", instance.Key); writer.WriteString("name", instance.Name); writer.WritePropertyName("coordinationPolicy"); configuration.Definitions[instance.Definition].CoordinationPolicy.WriteTo(writer); var existing = binding.Identities.FirstOrDefault(identity => identity.InstanceKey == instance.Key); if (existing is not null) { writer.WriteStartObject("identity"); writer.WriteString("agentId", existing.AgentId); writer.WriteString("accessToken", existing.Account.AccessToken); writer.WriteEndObject(); } writer.WriteEndObject(); }
            writer.WriteEndArray(); if (binding.ControllerCredential is not null) writer.WriteString("controllerCredential", binding.ControllerCredential);
        });
        var digest = Identity.Hash(WireJson.Compact(input)); var publicClient = clients(null);
        if (binding.Request?.Digest == digest)
        {
            var previous = await Exchange(binding.Request, publicClient, cancellation); if (!previous.IsSuccess) return Result<Unit>.Fail(previous.Error); if (WireJson.Text(previous.Value, "status") is "rejected" or "expired") { binding = binding with { Request = null }; var saved = BindingFiles.Save(configuration.Directory, binding); if (!saved.IsSuccess) return saved; }
        }
        if (binding.Request is null || binding.Request.Digest != digest)
        {
            var preflight = await publicClient.Call(new("preflight", new Dictionary<string, string>(), input), cancellation); if (!preflight.IsSuccess) return Result<Unit>.Fail(preflight.Error); if (!preflight.Value.TryGetProperty("available", out var available) || available.ValueKind != JsonValueKind.True) return Results.Fail<Unit>("name_collision", "One or more requested agent names already exist for this owner; choose unique names and deploy the complete roster again");
            var secret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_'); binding = binding with { Request = new(Identity.Identifier(), secret, digest) }; var saved = BindingFiles.Save(configuration.Directory, binding); if (!saved.IsSuccess) return saved;
        }
        var claim = binding.Request ?? throw new InvalidDataException("Enrollment claim was not durably prepared"); var introducedInput = WireJson.Object(writer => { foreach (var field in input.EnumerateObject()) field.WriteTo(writer); writer.WriteString("enrollmentId", claim.EnrollmentId); writer.WriteString("claimSecret", claim.ClaimSecret); });
        var introduced = await publicClient.Call(new("introduceEnrollment", new Dictionary<string, string>(), introducedInput), cancellation); if (!introduced.IsSuccess) return Result<Unit>.Fail(introduced.Error); var waiting = false;
        for (;;)
        {
            cancellation.ThrowIfCancellationRequested(); var response = await Exchange(claim, publicClient, cancellation); if (!response.IsSuccess) return Result<Unit>.Fail(response.Error); var status = WireJson.Text(response.Value, "status");
            if (status is "rejected" or "expired") { var saved = BindingFiles.Save(configuration.Directory, binding with { Request = null }); return saved.IsSuccess ? Results.Fail<Unit>("forbidden", "Fleet enrollment is " + status + "; start again to request a new owner review") : saved; }
            if (status == "pending" && !waiting)
            {
                if (WireJson.Text(introduced.Value, "approvalUrl") is not { } url || !introduced.Value.TryGetProperty("enrollment", out var details) || !details.TryGetProperty("enrollment", out var record) || WireJson.Text(record, "verificationCode") is not { Length: 12 } code) return Results.Fail<Unit>("invalid", "Enrollment did not supply its exact owner approval URL and code"); waiting = true; approval(new(url, code));
            }
            if (status == "ready")
            {
                if (WireJson.Text(response.Value, "ownerBackendUserId") != binding.Owner || !response.Value.TryGetProperty("fleet", out var fleet) || fleet.ValueKind != JsonValueKind.Object || WireJson.Text(fleet, "fleetId") is not { } fleetId || !Validation.Identifier(fleetId) || !response.Value.TryGetProperty("instances", out var identities) || identities.ValueKind != JsonValueKind.Array || identities.GetArrayLength() != roster.Instances.Count) return Results.Fail<Unit>("invalid", "Enrollment does not match the approved complete fleet");
                var credential = WireJson.Text(fleet, "controllerCredential") ?? binding.ControllerCredential; if (credential is null) return Results.Fail<Unit>("forbidden", "This fleet controller has not been authorized"); var selected = new List<BoundIdentity>();
                foreach (var identity in identities.EnumerateArray())
                {
                    var key = WireJson.Text(identity, "instanceKey"); var name = WireJson.Text(identity, "name"); var agent = WireJson.Text(identity, "agentId"); var requested = roster.Instances.FirstOrDefault(instance => instance.Key == key && instance.Name == name);
                    if (requested is null || selected.Any(value => value.InstanceKey == key) || agent is null || !Validation.Identifier(agent) || !identity.TryGetProperty("account", out var account)) return Results.Fail<Unit>("invalid", "Unexpected or incomplete approved enrollment identity");
                    var parsed = MessagingContract.Account(account); if (!parsed.IsSuccess) return Result<Unit>.Fail(parsed.Error);
                    var existing = binding.Identities.FirstOrDefault(value => value.InstanceKey == key); if (existing is not null && (existing.AgentId != agent || existing.Account.UserId != parsed.Value.UserId)) return Results.Fail<Unit>("conflict", "An enrolled agent identity cannot be replaced"); if (existing is null) BindingFiles.InitializeHistory(configuration.Directory, agent, null); selected.Add(new(key!, name!, agent, parsed.Value));
                }
                binding = binding with { FleetId = fleetId, ControllerCredential = credential, Request = null, Identities = binding.Identities.Where(identity => selected.All(value => value.InstanceKey != identity.InstanceKey)).Concat(selected).ToArray() }; var saved = BindingFiles.Save(configuration.Directory, binding); if (!saved.IsSuccess) return saved;
                var client = clients(credential); var current = await client.Call(new("fleet", new Dictionary<string, string> { ["fleetId"] = fleetId }), cancellation); if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
                var updated = await client.Call(new("changeFleet", new Dictionary<string, string> { ["fleetId"] = fleetId }, WireJson.Object(writer => { writer.WriteNumber("expectedRevision", current.Value.GetProperty("revision").GetInt64()); writer.WriteString("label", WireJson.Text(current.Value, "label")); writer.WritePropertyName("controller"); FleetWire.Controller(controller).WriteTo(writer); })), cancellation); return updated.Map(_ => default(Unit));
            }
            if (status != "pending") return Results.Fail<Unit>("invalid", "Unknown enrollment exchange state"); await Task.Delay(TimeSpan.FromSeconds(1), clock, cancellation);
        }
    }
    private static ValueTask<Result<JsonElement>> Exchange(EnrollmentClaim claim, Coordination client, CancellationToken cancellation)
        => client.Call(new("exchangeEnrollment", new Dictionary<string, string> { ["enrollmentId"] = claim.EnrollmentId }, WireJson.Object(writer => writer.WriteString("claimSecret", claim.ClaimSecret))), cancellation);
}
