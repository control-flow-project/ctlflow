using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Domain;

namespace Fleetd.Contracts;

public static class ExecutionContract
{
    public static Result<Unit> Validate(IEnumerable<ExecutionPlacement> placements, ExecutionCatalog? catalog)
    {
        foreach (var placement in placements)
            if (placement.Kind == ExecutionKind.Vm && (catalog is null || placement.Image is null || placement.Profile is null
                || !catalog.Images.ContainsKey(placement.Image) || !catalog.Profiles.ContainsKey(placement.Profile)))
                return Results.Fail<Unit>("invalid", "VM execution must reference an image and profile in this fleet execution catalog");
        return Results.Done();
    }

    public static Result<ExecutionPlacement> Placement(JsonElement value)
    {
        if (!Validation.Fields(value, ["kind"], ["image", "profile"]).IsSuccess)
            return Results.Fail<ExecutionPlacement>("invalid", "Select host or VM execution");
        var kind = Validation.Choice(value.GetProperty("kind"), "host", "vm");
        if (!kind.IsSuccess) return Result<ExecutionPlacement>.Fail(kind.Error);
        if (kind.Value == "host") return Validation.Fields(value, ["kind"]).Map(_ => new ExecutionPlacement(ExecutionKind.Host));
        if (!Validation.Fields(value, ["kind", "image", "profile"]).IsSuccess
            || WireJson.Text(value, "image") is not { } image || !IdentitySyntax.Name(image)
            || WireJson.Text(value, "profile") is not { } profile || !IdentitySyntax.Name(profile))
            return Results.Fail<ExecutionPlacement>("invalid", "VM execution requires an exact fleet image and profile name");
        return Result<ExecutionPlacement>.Success(new(ExecutionKind.Vm, image, profile));
    }

    public static JsonElement Placement(ExecutionPlacement value) => WireJson.Object(writer =>
    {
        if (!Enum.IsDefined(value.Kind) || value.Kind == ExecutionKind.Host && (value.Image is not null || value.Profile is not null)
            || value.Kind == ExecutionKind.Vm && (value.Image is null || !IdentitySyntax.Name(value.Image) || value.Profile is null || !IdentitySyntax.Name(value.Profile)))
            throw new ArgumentException("Invalid execution placement");
        writer.WriteString("kind", value.Kind == ExecutionKind.Host ? "host" : "vm");
        if (value.Kind == ExecutionKind.Vm) { writer.WriteString("image", value.Image); writer.WriteString("profile", value.Profile); }
    });

    private static Result<string> Absolute(JsonElement value) => Validation.Text(value, 4096).Bind(path =>
        FleetConfigurationContract.Absolute(path) ? Result<string>.Success(path) : Results.Fail<string>("invalid", "Use an absolute normalized path"));

    private static Result<VmImage> Image(JsonElement value)
    {
        if (!Validation.Fields(value, ["path", "sha256"]).IsSuccess) return Results.Fail<VmImage>("invalid", "Invalid VM image fields");
        var path = Absolute(value.GetProperty("path")); var digest = Validation.Text(value.GetProperty("sha256"), 64, 64);
        return path.IsSuccess && digest.IsSuccess && digest.Value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f')
            ? Result<VmImage>.Success(new(path.Value, digest.Value)) : Results.Fail<VmImage>("invalid", "VM image requires its exact path and lowercase SHA256 digest");
    }

    private static Result<VmMount> Mount(JsonElement value)
    {
        if (!Validation.Fields(value, ["path", "read_only"]).IsSuccess) return Results.Fail<VmMount>("invalid", "Invalid VM mount fields");
        var path = Absolute(value.GetProperty("path")); var readOnly = Validation.Boolean(value.GetProperty("read_only"));
        return path.IsSuccess && readOnly.IsSuccess ? Result<VmMount>.Success(new(path.Value, readOnly.Value))
            : Results.Fail<VmMount>("invalid", "VM mount requires its exact path and read-only selection");
    }

    private static Result<VmProfile> Profile(JsonElement value)
    {
        if (!Validation.Fields(value, ["cpus", "memory_mib", "maximum_memory_mib", "network", "mounts"]).IsSuccess)
            return Results.Fail<VmProfile>("invalid", "Invalid VM profile fields");
        var cpus = Validation.Integer(value.GetProperty("cpus"), 1, 64);
        var memory = Validation.Integer(value.GetProperty("memory_mib"), 256, 1048576);
        var maximum = Validation.Integer(value.GetProperty("maximum_memory_mib"), 256, 1048576);
        var network = Validation.Choice(value.GetProperty("network"), "disabled", "outbound");
        var mounts = Validation.List(value.GetProperty("mounts"), Mount, 100);
        if (!cpus.IsSuccess || !memory.IsSuccess || !maximum.IsSuccess || !network.IsSuccess || !mounts.IsSuccess || memory.Value > maximum.Value)
            return Results.Fail<VmProfile>("invalid", "Invalid VM CPU, memory, network or mount selection");
        var paths = mounts.Value.Select(mount => mount.Path).ToArray();
        if (paths.Distinct(StringComparer.Ordinal).Count() != paths.Length || paths.Any(path => paths.Any(other => other != path && other.StartsWith(path + "/", StringComparison.Ordinal))))
            return Results.Fail<VmProfile>("invalid", "VM profile mounts cannot duplicate or overlap");
        return Result<VmProfile>.Success(new((int)cpus.Value, (int)memory.Value, (int)maximum.Value,
            network.Value == "disabled" ? VmNetwork.Disabled : VmNetwork.Outbound, mounts.Value));
    }

    private static Result<IReadOnlyDictionary<string, T>> Named<T>(JsonElement value, Func<JsonElement, Result<T>> parse)
    {
        if (value.ValueKind != JsonValueKind.Object) return Results.Fail<IReadOnlyDictionary<string, T>>("invalid", "Expected named execution definitions");
        var entries = value.EnumerateObject().ToArray(); var result = new Dictionary<string, T>(StringComparer.Ordinal);
        if (entries.Length is < 1 or > 100) return Results.Fail<IReadOnlyDictionary<string, T>>("invalid", "Use 1–100 named execution definitions");
        foreach (var entry in entries)
        {
            if (!IdentitySyntax.Name(entry.Name) || result.ContainsKey(entry.Name)) return Results.Fail<IReadOnlyDictionary<string, T>>("invalid", "Invalid or duplicate execution name");
            var parsed = parse(entry.Value); if (!parsed.IsSuccess) return Result<IReadOnlyDictionary<string, T>>.Fail(parsed.Error); result.Add(entry.Name, parsed.Value);
        }
        return Result<IReadOnlyDictionary<string, T>>.Success(result);
    }

    public static Result<ExecutionCatalog> Catalog(JsonElement value)
    {
        if (!Validation.Fields(value, ["memory_budget_mib", "host_reserve_mib", "images", "profiles"]).IsSuccess)
            return Results.Fail<ExecutionCatalog>("invalid", "Invalid execution catalog fields");
        var budget = Validation.Integer(value.GetProperty("memory_budget_mib"), 512, 1048576);
        var reserve = Validation.Integer(value.GetProperty("host_reserve_mib"), 256, 1048576);
        var images = Named(value.GetProperty("images"), Image); var profiles = Named(value.GetProperty("profiles"), Profile);
        if (!budget.IsSuccess || !reserve.IsSuccess || !images.IsSuccess || !profiles.IsSuccess)
            return Results.Fail<ExecutionCatalog>("invalid", "Invalid execution budget, image or profile definitions");
        if (profiles.Value.Values.Any(profile => profile.MaximumMemoryMiB > budget.Value))
            return Results.Fail<ExecutionCatalog>("invalid", "VM maximum must fit the controller memory budget");
        return Result<ExecutionCatalog>.Success(new((int)budget.Value, (int)reserve.Value, images.Value, profiles.Value));
    }
}
