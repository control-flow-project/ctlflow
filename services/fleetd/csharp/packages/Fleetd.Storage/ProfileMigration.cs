using Crossfire.AdapterFilesystem;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Domain;

namespace Fleetd.Storage;

public static class ProfileMigration
{
    private sealed record Intent(string Agent, string Source, string Target, bool HadState);
    private static T Value<T>(Result<T> value) => value.IsSuccess ? value.Value : throw new InvalidDataException(value.Error.Message);
    private static void VerifyState(string state)
    { PrivateFiles.ExistingDirectory(state, true); using var owner = new StateLock(Path.Combine(state, "listener")); using var receiver = new StateLock(Path.Combine(state, "receiver")); }
    public static void Run(FleetConfiguration configuration, FleetBinding binding)
    {
        foreach (var instance in configuration.Roster.Instances)
        {
            var identity = binding.Identities.FirstOrDefault(value => value.InstanceKey == instance.Key); var workspace = Path.Combine(configuration.Directory, instance.Workarea); if (identity is null || !PrivateFiles.Exists(workspace)) continue;
            var current = AgentProjects.Paths(workspace, instance.Key); var journal = Path.Combine(current.Root, "profile-migration-" + instance.Key + ".json"); if (identity.Name == instance.Key && !PrivateFiles.Exists(journal)) continue;
            var old = AgentProjects.Paths(workspace, identity.Name); if (!PrivateFiles.Exists(journal) && !PrivateFiles.Exists(old.Profile) && !PrivateFiles.Exists(old.State)) continue;
            PrivateFiles.Directory(current.Root); using var conversion = new StateLock(Path.Combine(current.Root, "profile-conversion-" + instance.Key)); Intent? intent = null;
            if (PrivateFiles.Exists(journal))
            {
                var value = WireJson.Parse(PrivateFiles.Read(journal, 1048576)); Value(Validation.Fields(value, ["agentId", "source", "target", "hadState"])); var source = WireJson.Text(value, "source");
                if (WireJson.Text(value, "agentId") != identity.AgentId || WireJson.Text(value, "target") != instance.Key || source is null || !IdentitySyntax.Name(source)) throw new InvalidDataException("Profile conversion belongs to another identity"); intent = new(identity.AgentId, source, instance.Key, Value(Validation.Boolean(value.GetProperty("hadState"))));
            }
            if (intent is null && identity.Name == instance.Key) continue; var previous = AgentProjects.Paths(workspace, intent?.Source ?? identity.Name);
            if (intent is null && !PrivateFiles.Exists(previous.Profile)) { if (PrivateFiles.Exists(previous.State)) throw new InvalidDataException("Profile conversion has state without its private identity"); continue; }
            if (PrivateFiles.Exists(previous.Profile) == PrivateFiles.Exists(current.Profile)) throw new InvalidDataException("Profile conversion requires exactly one owned identity profile");
            var profile = Value(AgentProfiles.Parse(WireJson.Parse(PrivateFiles.Read(PrivateFiles.Exists(previous.Profile) ? previous.Profile : current.Profile, 1048576))));
            if (profile.Id != identity.AgentId || profile.Account.UserId != identity.Account.UserId || profile.Settings.Homeserver != binding.Server || profile.Settings.Owner != binding.Owner) throw new InvalidDataException("Profile conversion identity differs from its fleet");
            if (intent is null)
            {
                if (PrivateFiles.Exists(current.State)) throw new InvalidDataException("Profile conversion cannot merge listener histories"); var hadState = PrivateFiles.Exists(previous.State); if (hadState) VerifyState(previous.State); intent = new(identity.AgentId, identity.Name, instance.Key, hadState);
                PrivateFiles.Write(journal, WireJson.Bytes(WireJson.Object(writer => { writer.WriteString("agentId", intent.Agent); writer.WriteString("source", intent.Source); writer.WriteString("target", intent.Target); writer.WriteBoolean("hadState", intent.HadState); }), true), 1048576);
            }
            if (intent.HadState)
            {
                if (PrivateFiles.Exists(previous.State) == PrivateFiles.Exists(current.State)) throw new InvalidDataException("Profile conversion requires exactly one retained listener history"); VerifyState(PrivateFiles.Exists(previous.State) ? previous.State : current.State); if (PrivateFiles.Exists(previous.State)) ManagedLinks.PublishDirectory(previous.State, current.State);
            }
            else if (PrivateFiles.Exists(previous.State) || PrivateFiles.Exists(current.State)) throw new InvalidDataException("Profile conversion state changed unexpectedly");
            PrivateFiles.Directory(Path.GetDirectoryName(current.Profile)!); if (PrivateFiles.Exists(previous.Profile)) PrivateFiles.MovePrivate(previous.Profile, current.Profile); PrivateFiles.DeletePrivate(journal);
        }
    }
}
