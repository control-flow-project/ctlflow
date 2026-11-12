using System.Security.Cryptography;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterProcess;
using Fleetd.AdapterExecution.Vm;
using Fleetd.Domain;

static class ImagesAcceptance
{
    public static async Task Run(string root, Action<bool, string> check)
    {
        async Task<VmImage> Create(string name, IReadOnlyList<string> options)
        {
            var path = Path.Combine(root, name + ".qcow2");
            var created = await NativeProcess.Capture(new("/usr/bin/qemu-img", ["create", "-f", "qcow2", ..options, path, "4M"], root,
                new Dictionary<string, string?>()), 8192, 10000, CancellationToken.None);
            check(created.IsSuccess && created.Value.ExitCode == 0, "Actual QEMU creates the " + name + " image fixture");
            if (!created.IsSuccess || created.Value.ExitCode != 0) throw new IOException(created.IsSuccess ? created.Value.Errors : created.Error.Message);
            File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            using var file = new FileStream(path, FileMode.Open, FileAccess.Read);
            return new(path, Convert.ToHexStringLower(await SHA256.HashDataAsync(file)));
        }
        var selfContained = await Create("base", []);
        check((await Images.Verify(selfContained, CancellationToken.None)).IsSuccess, "Exact approved standalone qcow2 image passes actual QEMU inspection");
        var mismatch = await Images.Verify(selfContained with { Sha256 = new string('0', 64) }, CancellationToken.None);
        check(!mismatch.IsSuccess && mismatch.Error.Message.Contains("SHA256", StringComparison.Ordinal), "An incorrect image digest is rejected before launch");
        var backed = await Create("external-backing", ["-F", "qcow2", "-b", selfContained.Path]);
        check(!(await Images.Verify(backed, CancellationToken.None)).IsSuccess, "Even an approved digest cannot authorize an external backing chain");
        var externalData = await Create("external-data", ["-o", "data_file=" + Path.Combine(root, "external.raw")]);
        check(!(await Images.Verify(externalData, CancellationToken.None)).IsSuccess, "Even an approved digest cannot authorize an external data file");
        var link = Path.Combine(root, "linked-image.qcow2"); File.CreateSymbolicLink(link, selfContained.Path);
        check(!(await Images.Verify(selfContained with { Path = link }, CancellationToken.None)).IsSuccess, "Symlink image paths cannot replace the approved regular file");
        File.SetUnixFileMode(selfContained.Path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.OtherWrite);
        check(!(await Images.Verify(selfContained, CancellationToken.None)).IsSuccess, "An image writable by other users is rejected");
        File.SetUnixFileMode(selfContained.Path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        var cancelled = new CancellationToken(canceled: true);
        try { await Images.Verify(selfContained, cancelled); throw new InvalidOperationException("Cancelled image hashing was admitted"); }
        catch (OperationCanceledException) { check(true, "Image hashing respects cancellation without loading the whole image"); }
    }
}
