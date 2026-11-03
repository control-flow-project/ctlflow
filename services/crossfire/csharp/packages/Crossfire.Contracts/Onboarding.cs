using System.Text;
using System.Text.Json;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Contracts;

public static class Onboarding
{
    public static Result<SetupDescriptor> ParseDescriptor(JsonElement value)
    {
        if (!Validation.Fields(value, ["schemaVersion", "server", "ownerBackendUserId", "package", "instructions"]).IsSuccess || !value.GetProperty("schemaVersion").TryGetInt32(out var version) || version != 1 || !Validation.Fields(value.GetProperty("package"), ["name", "version"]).IsSuccess || WireJson.Text(value.GetProperty("package"), "name") != "fleet") return Results.Fail<SetupDescriptor>("invalid", "Invalid Crossfire setup descriptor");
        var server = WireJson.Text(value, "server"); var owner = WireJson.Text(value, "ownerBackendUserId"); var package = WireJson.Text(value.GetProperty("package"), "version"); var instructions = Validation.PlainText(value.GetProperty("instructions"), 131072);
        return server is not null && Validation.Origin(server).IsSuccess && owner is not null && Validation.UserId(owner) && package is not null && ReleaseValues.Version(package) && instructions.IsSuccess ? Result<SetupDescriptor>.Success(new(server, owner, package, instructions.Value)) : Results.Fail<SetupDescriptor>("invalid", "Invalid setup authority, package version or instructions");
    }
    private static string Quote(string value) => "'" + value.Replace("'", "'\\''", StringComparison.Ordinal) + "'";
    public static string DescriptorUrl(string origin, string owner) => origin + "/onboarding/setup.json?ownerBackendUserId=" + Uri.EscapeDataString(owner)
        .Replace("%21", "!", StringComparison.Ordinal).Replace("%27", "'", StringComparison.Ordinal).Replace("%28", "(", StringComparison.Ordinal).Replace("%29", ")", StringComparison.Ordinal).Replace("%2A", "*", StringComparison.Ordinal);
    public static JsonElement Descriptor(string origin, string owner, string version, string instructions)
        => WireJson.Object(writer =>
        {
            writer.WriteNumber("schemaVersion", 1); writer.WriteString("server", origin); writer.WriteString("ownerBackendUserId", owner);
            writer.WriteStartObject("package"); writer.WriteString("name", "fleet"); writer.WriteString("version", version); writer.WriteEndObject(); writer.WriteString("instructions", instructions);
        });
    public static string Command(string origin, string owner, string version)
        => string.Join('\n', new[]
        {
            "set -eu", "umask 077",
            "command -v fleet >/dev/null || { printf \"%s\\n\" \"Install the native ctlflow " + version + " distribution and put fleet on PATH.\" >&2; exit 1; }",
            "command -v git >/dev/null || { printf \"%s\\n\" \"Install Git: https://git-scm.com/downloads\" >&2; exit 1; }",
            "fleet setup --descriptor " + Quote(DescriptorUrl(origin, owner))
        });
    public static string Guide(string origin, string owner, string version, string instructions)
    {
        var text = new StringBuilder();
        foreach (var line in new[]
        {
            "# Set up a crossfire agent", "",
            "crossfire lets people message managed agents through Messaging. fleetd owns each agent’s native session and the shared listener; a single agent is an ordinary one-agent fleet.",
            "These instructions are for the coding harness performing setup. Run them on the computer where native agents will execute; Docker hosts the server only. Install the matching native fleet and fleetd distribution into private user-owned storage; NativeAOT is the default. Keep its packaged directories and artifacts together. The selected Codex/Pi installation and native login must already exist there. Do not install or upgrade a harness or copy provider credentials into Docker. NativeAOT and Rust distributions do not require Node.js or a .NET runtime to execute fleet or fleetd. The optional intentional messaging tools and the selected Pi harness retain their own Node.js prerequisites. Do not attach this coding session; fleetd starts a separate managed native session.",
            "Server: " + origin, "Verified human owner: " + owner, "", "## 1. Check prerequisites",
            "Use the human-selected project directory on Linux x64. Requires the matching native fleet/fleetd distribution, Git, Bash and an existing supported native harness with provider login. Codex is the default; Earendil Pi requires explicit ordinary fleet configuration. Check the installed distribution version, git --version and the selected harness version. The controller performs model-free native capability and authentication checks before enrolling or starting an agent.",
            "If a prerequisite or provider login is missing, stop and report it. The user must install missing prerequisites or complete the selected harness native login before repeating setup. Never install or upgrade Codex/Pi as part of these instructions. Official prerequisite documentation: https://nodejs.org/en/download ; https://git-scm.com/downloads ; https://developers.openai.com/codex/cli . Never request Messaging passwords, administrator tokens, ports or session IDs. Do not use sudo, change host services or install global skills.",
            "This coding session only performs setup. It stays independent: its process, conversation and project-native settings are not adopted or imported. fleetd creates a separate managed session. Subsequent resume and wake reuse that managed session’s saved histories. Linux inert-provider checks are not macOS or paid-provider certification.",
            "", "## 2. Run the complete setup command",
            "Inspect and run this Bash command from the project directory. It uses the installed native CLI/controller and runs one noninteractive setup operation. The descriptor checks the exact installed release version; it never downloads or substitutes another implementation. It asks no naming, model, controller or room questions. Stable names and state are derived and persisted automatically.",
            "", "```bash", Command(origin, owner, version), "```", "",
            "Optional overrides use fleet setup --descriptor " + Quote(DescriptorUrl(origin, owner)) + " --config /absolute/runtime.toml. Do not generate a configuration just to repeat defaults.",
            "When awaiting approval, immediately show the exact approval URL and matching code to the human. Ordinary controller code continues waiting and resumes after approval; do not model-poll, enroll twice or start a separate listener. Human approval remains required authorization.",
            "Repeated setup reuses the selected project, controller, fleet, identities and histories. It never silently upgrades software or activates explicitly stopped sessions. Errors are actionable failures, not prompts to guess another identity.",
            "", "## 3. Confirm readiness and room access",
            "Setup returns the fleet identity and model-free readiness result. Use fleet test FLEET_KEY to verify the receiver, fleet daemon status to inspect the controller and fleet show FLEET_KEY for read-only session details, using the returned fleet key. These checks never start or wake a stopped session. A controller process or saved credentials alone do not prove delivery is ready. Busy, paused, sleeping and stopped states are distinct; no artificial test message or model turn is needed.",
            "Enrollment creates no rooms or conversations. Humans create rooms in Element and invite the agent; authorized invitations grant read/reply access. Wake-up rules separately determine which senders trigger a turn. The first owner DM, actual terminal output or pending decision establishes a protected private owner conversation.",
            "The managed agent can check its receiver using node \"$CROSSFIRE_PROJECT/.crossfire/client.mjs\" agent test. It does not start a listener, make a model call or advance unread positions.",
            "Report the setup result and " + origin + "/manage/fleets to the human. Lifecycle, fresh-history confirmations, model parameters, terminal pointers and software versions are available in management.",
            "", "## Software updates",
            "fleet and fleetd are native distribution executables. npm workspaces are private build, UI, test and maintenance dependencies; they do not install services. A new release may notify the managed agent once. With human consent, install the matching native distribution into a new private release directory, run fleet update FLEET_KEY and restart the controller with fleet daemon restart. Explicitly stopped agents remain stopped; running agents resume their saved histories. Read changed skill content after the verified update. Do not replace a live receiver or re-enroll."
        }) text.Append(line).Append('\n');
        if (instructions.Length != 0) text.Append("\n## Instructions from this instance’s administrator\n").Append(instructions).Append('\n');
        return text.ToString();
    }
}
