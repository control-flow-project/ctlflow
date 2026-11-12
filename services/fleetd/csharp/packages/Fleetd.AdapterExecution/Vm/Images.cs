using System.Security.Cryptography;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterProcess;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Contracts;
using Fleetd.Domain;

namespace Fleetd.AdapterExecution.Vm;

public static class Images
{
    // One self-contained qcow2 base is the image contract. In particular an
    // approved header must not make QEMU open an unapproved host backing file.
    private static bool SelfContained(JsonElement image, string path)
    {
        if (image.ValueKind != JsonValueKind.Object || WireJson.Text(image, "format") != "qcow2" || WireJson.Text(image, "filename") != path
            || !image.TryGetProperty("virtual-size", out var size) || size.ValueKind != JsonValueKind.Number || !size.TryGetInt64(out var bytes) || bytes <= 0
            || image.TryGetProperty("backing-filename", out _) || image.TryGetProperty("full-backing-filename", out _)
            || image.TryGetProperty("backing-filename-format", out _) || image.TryGetProperty("encrypted", out var encrypted) && encrypted.ValueKind != JsonValueKind.False
            || !image.TryGetProperty("dirty-flag", out var dirty) || dirty.ValueKind != JsonValueKind.False
            || !image.TryGetProperty("format-specific", out var specific) || specific.ValueKind != JsonValueKind.Object
            || WireJson.Text(specific, "type") != "qcow2" || !specific.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object
            || data.TryGetProperty("data-file", out _) || data.TryGetProperty("encrypt", out _)
            || !data.TryGetProperty("corrupt", out var corrupt) || corrupt.ValueKind != JsonValueKind.False
            || !image.TryGetProperty("children", out var children) || children.ValueKind != JsonValueKind.Array || children.GetArrayLength() != 1)
            return false;
        var child = children[0];
        return child.ValueKind == JsonValueKind.Object && WireJson.Text(child, "name") == "file"
            && child.TryGetProperty("info", out var file) && file.ValueKind == JsonValueKind.Object
            && WireJson.Text(file, "format") == "file" && WireJson.Text(file, "filename") == path
            && file.TryGetProperty("children", out var descendants) && descendants.ValueKind == JsonValueKind.Array && descendants.GetArrayLength() == 0;
    }

    public static async ValueTask<Result<Unit>> Verify(VmImage image, CancellationToken cancellation)
    {
        if (!FleetConfigurationContract.Absolute(image.Path) || image.Path.Any(char.IsControl) || image.Sha256.Length != 64
            || image.Sha256.Any(value => value is not (>= '0' and <= '9' or >= 'a' and <= 'f')))
            return Results.Fail<Unit>("invalid", "VM image requires an exact private path and lowercase SHA256 digest");
        try
        {
            // Streaming keeps validation independent of guest image size.
            using var handle = PrivateFiles.OpenPrivate(image.Path);
            using var stream = new FileStream(handle, FileAccess.Read, 65536, isAsync: false);
            var digest = Convert.ToHexStringLower(await SHA256.HashDataAsync(stream, cancellation));
            if (digest != image.Sha256) return Results.Fail<Unit>("invalid", "VM image does not match its fleet-approved SHA256 digest");
            var inspected = await NativeProcess.Capture(new("/usr/bin/qemu-img", ["info", "--output=json", "-f", "qcow2", image.Path],
                Path.GetDirectoryName(image.Path)!, new Dictionary<string, string?>()), 65536, 30000, cancellation);
            if (!inspected.IsSuccess) return Result<Unit>.Fail(inspected.Error);
            if (inspected.Value.ExitCode != 0 || !SelfContained(WireJson.Parse(System.Text.Encoding.UTF8.GetBytes(inspected.Value.Output)), image.Path))
                return Results.Fail<Unit>("invalid", "VM image must be a clean self-contained qcow2 file without external backing, data or encryption");
            return Results.Done();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or JsonException)
        { return Results.Fail<Unit>("invalid", "Cannot read the private fleet VM image or inspect its current qcow2 metadata"); }
    }
}
