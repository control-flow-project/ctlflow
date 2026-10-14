using System.Text;
using Crossfire.AdapterFilesystem;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterClient;

public sealed record InstalledAgentSoftware(Release Release, string Directory, string Skill, Action Activate);
public static class AgentSoftware
{
    public static InstalledAgentSoftware Installed(string root)
    {
        var link = Path.Combine(root, "client.mjs"); if (!PrivateFiles.Exists(link)) throw new IOException("Automatic recovery requires the previously approved controller-installed software"); var target = ManagedLinks.Read(link); var parts = target.Split('/');
        if (parts.Length != 3 || parts[0] != "software" || parts[2] != "crossfire-client.mjs" || parts[1].Contains('\\') || !ReleaseValues.Identity(parts[1])) throw new IOException("The project client entry is not a managed Crossfire installation");
        var directory = Path.Combine(root, "software", parts[1]); PrivateFiles.ExistingDirectory(directory, true); var release = Releases.Load(directory); if (release.Identity != parts[1]) throw new IOException("Installed release identity differs from its directory"); return new(release, directory, Encoding.UTF8.GetString(release.Files["SKILL.md"]), () => { });
    }
    public static InstalledAgentSoftware Install(string root, string releaseDirectory)
    {
        PrivateFiles.Directory(root); using var ownership = new StateLock(Path.Combine(root, "software-install")); PrivateFiles.ExistingDirectory(releaseDirectory, false); var release = Releases.Load(releaseDirectory); if (PrivateFiles.Exists(Path.Combine(root, "client.mjs"))) Installed(root);
        var software = PrivateFiles.Directory(Path.Combine(root, "software")); var directory = Path.Combine(software, release.Identity);
        if (!PrivateFiles.Exists(directory))
        {
            var staging = PrivateFiles.Directory(Path.Combine(software, ".install-" + Identity.Identifier())); var published = false;
            try { foreach (var file in release.Files) PrivateFiles.Write(Path.Combine(staging, file.Key), file.Value, 8388608); PrivateFiles.Write(Path.Combine(staging, "manifest.json"), WireJson.Bytes(release.Manifest, true), 16384); Releases.Load(staging); ManagedLinks.PublishDirectory(staging, directory); published = true; }
            finally { if (!published) { foreach (var name in Releases.ArtifactNames.Append("manifest.json")) { var path = Path.Combine(staging, name); if (PrivateFiles.Exists(path)) PrivateFiles.DeletePrivate(path); } System.IO.Directory.Delete(staging); } }
        }
        PrivateFiles.ExistingDirectory(directory, true); if (Releases.Load(directory).Identity != release.Identity) throw new IOException("Installed release differs from the approved manifest");
        return new(release, directory, Encoding.UTF8.GetString(release.Files["SKILL.md"]), () => ManagedLinks.Replace(Path.Combine(root, "client.mjs"), "software/" + release.Identity + "/crossfire-client.mjs"));
    }
}
