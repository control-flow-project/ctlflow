using Crossfire.Kernel;
using Fleetd.Domain;

namespace Fleetd.Domain;

public static class VmExports
{
    private static bool Absolute(string path) => path.StartsWith('/') && path.Length <= 4096 && path != "/" && !path.Contains('\\')
        && !path.Any(char.IsControl) && path.Split('/').Skip(1).All(part => part.Length != 0 && part is not ("." or ".."));
    private static bool Contains(string directory, string path) => path == directory || path.StartsWith(directory + "/", StringComparison.Ordinal);
    private static bool Overlap(string left, string right) => Contains(left, right) || Contains(right, left);

    // Native state and cwd keep exactly the same paths in both kernels. Extra
    // mounts are explicit; they cannot broaden access to host control or peers.
    public static Result<IReadOnlyList<VmMount>> Plan(string state, string workspace, string control,
        IReadOnlyList<string> protectedRoots, IReadOnlyList<VmMount> additional)
    {
        if (!Absolute(state) || !Absolute(workspace) || !Absolute(control) || protectedRoots.Any(path => !Absolute(path))
            || additional.Any(mount => !Absolute(mount.Path)))
            return Results.Fail<IReadOnlyList<VmMount>>("invalid", "VM exports require absolute normalized directory paths");
        var mounts = Contains(state, workspace) ? new List<VmMount> { new(state, false) }
            : Contains(workspace, state) ? [new(workspace, false)] : [new(state, false), new(workspace, false)];
        foreach (var mount in additional)
        {
            if (mounts.Any(existing => Overlap(existing.Path, mount.Path)))
                return Results.Fail<IReadOnlyList<VmMount>>("invalid", "VM exports cannot duplicate or overlap another export");
            mounts.Add(mount);
        }
        if (mounts.Any(mount => Overlap(control, mount.Path) || protectedRoots.Concat(new[] { "/proc", "/sys", "/dev", "/run" }).Any(protectedRoot => Overlap(protectedRoot, mount.Path))))
            return Results.Fail<IReadOnlyList<VmMount>>("invalid", "VM exports cannot expose host control, credentials or peer workareas");
        return Result<IReadOnlyList<VmMount>>.Success(mounts);
    }
}
