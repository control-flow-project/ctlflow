using Crossfire.Kernel;

namespace Crossfire.AdapterFilesystem;

public sealed record AgentProjectPaths(string Workspace, string Root, string Profile, string State, string Cursors);
public static class AgentProjects
{
    public static AgentProjectPaths Paths(string project, string profile)
    {
        if (!IdentitySyntax.Name(profile)) throw new InvalidDataException("Invalid immutable agent profile"); PrivateFiles.ExistingDirectory(project, true); var root = Path.Combine(project, ".crossfire"); var state = Path.Combine(root, "state", profile);
        return new(project, root, Path.Combine(root, "profiles", profile + ".json"), state, Path.Combine(state, "cursors.json"));
    }
}
