using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed class ReleaseNotices(LocalState storage, string cursorFile, string installed, string owner, string session)
{
    private readonly string path = cursorFile + ".update." + Identity.Hash(session);
    private string? pending;
    private IReadOnlyList<string> Notified()
    {
        if (!storage.Exists(path)) return []; var value = AgentIO.Read(storage, path); var parsed = Validation.List(value, release => Validation.Text(release, 255).Bind(text => ReleaseValues.Identity(text) ? Result<string>.Success(text) : Results.Fail<string>("invalid", "Invalid saved release notice")), 4096);
        return parsed.IsSuccess && parsed.Value.Distinct(StringComparer.Ordinal).Count() == parsed.Value.Count ? parsed.Value : throw new InvalidDataException("Invalid saved release notices");
    }
    public void Available(string release) { if (!ReleaseValues.Identity(release)) throw new InvalidDataException("Invalid server release"); pending = release != installed && !Notified().Contains(release, StringComparer.Ordinal) ? release : null; }
    public bool Pending => pending is not null;
    public async ValueTask<Result<Unit>> Publish(RuntimeConnection runtime, CancellationToken cancellation)
    {
        if (pending is not { } release) return Results.Done(); if (runtime.SessionId != session) return Results.Fail<Unit>("conflict", "Update notice session changed"); var saved = Notified(); if (saved.Count >= 4096) return Results.Fail<Unit>("limit", "Saved release notices exceed their safety bound");
        var id = "crossfire-update-" + Identity.Hash(WireJson.Compact(WireJson.Array(writer => { writer.WriteStringValue(session); writer.WriteStringValue(release); })));
        var text = "Crossfire software update: release " + release + " is available. This is a trusted listener maintenance notice, not a room message. Ask the human owner " + owner + " whether to update the fleet controller and its installed Crossfire skills. Do not update without consent. Follow the installed Crossfire skill’s controller update workflow after consent. Do not launch another listener. Read changed skill content after the update. Preserve the existing identity, room grants and native history. No other action is authorized by this notice.";
        var result = await runtime.Deliver(text, id, cancellation); if (!result.IsSuccess) return result; AgentIO.Write(storage, path, WireJson.Array(writer => { foreach (var value in saved) writer.WriteStringValue(value); writer.WriteStringValue(release); })); var accepted = runtime.Acknowledge([id]); if (accepted.IsSuccess && pending == release) pending = null; return accepted;
    }
}
