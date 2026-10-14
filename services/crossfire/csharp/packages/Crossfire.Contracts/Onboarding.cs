using System.Text;
using System.Text.Json;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Contracts;

public static class Onboarding
{
    public static Result<SetupDescriptor> ParseDescriptor(JsonElement value)
    {
        if (!Validation.Fields(value, ["schemaVersion", "server", "ownerMatrixId", "package", "instructions"]).IsSuccess || !value.GetProperty("schemaVersion").TryGetInt32(out var version) || version != 1 || !Validation.Fields(value.GetProperty("package"), ["name", "version"]).IsSuccess || WireJson.Text(value.GetProperty("package"), "name") != "@ctlflow/fleet") return Results.Fail<SetupDescriptor>("invalid", "Invalid Crossfire setup descriptor");
        var server = WireJson.Text(value, "server"); var owner = WireJson.Text(value, "ownerMatrixId"); var package = WireJson.Text(value.GetProperty("package"), "version"); var instructions = Validation.PlainText(value.GetProperty("instructions"), 131072);
        return server is not null && Validation.Origin(server).IsSuccess && owner is not null && Validation.UserId(owner) && package is not null && ReleaseValues.Version(package) && instructions.IsSuccess ? Result<SetupDescriptor>.Success(new(server, owner, package, instructions.Value)) : Results.Fail<SetupDescriptor>("invalid", "Invalid setup authority, package version or instructions");
    }
    private static string Quote(string value) => "'" + value.Replace("'", "'\\''", StringComparison.Ordinal) + "'";
    public static string DescriptorUrl(string origin, string owner) => origin + "/onboarding/setup.json?ownerMatrixId=" + Uri.EscapeDataString(owner)
        .Replace("%21", "!", StringComparison.Ordinal).Replace("%27", "'", StringComparison.Ordinal).Replace("%28", "(", StringComparison.Ordinal).Replace("%29", ")", StringComparison.Ordinal).Replace("%2A", "*", StringComparison.Ordinal);
    public static JsonElement Descriptor(string origin, string owner, string version, string instructions)
        => WireJson.Object(writer =>
        {
            writer.WriteNumber("schemaVersion", 1); writer.WriteString("server", origin); writer.WriteString("ownerMatrixId", owner);
            writer.WriteStartObject("package"); writer.WriteString("name", "@ctlflow/fleet"); writer.WriteString("version", version); writer.WriteEndObject(); writer.WriteString("instructions", instructions);
        });
    public static string Command(string origin, string owner, string version)
        => string.Join('\n', new[]
        {
            "set -eu", "umask 077",
            "command -v node >/dev/null || { printf \"%s\\n\" \"Install Node.js 26+: https://nodejs.org/en/download\" >&2; exit 1; }",
            "node -e 'if(Number(process.versions.node.split(\".\")[0]) < 26) { console.error(\"Install Node.js 26+: https://nodejs.org/en/download\"); process.exit(1); }'",
            "command -v npm >/dev/null || { printf \"%s\\n\" \"Install npm with Node.js: https://nodejs.org/en/download\" >&2; exit 1; }",
            "command -v git >/dev/null || { printf \"%s\\n\" \"Install Git: https://git-scm.com/downloads\" >&2; exit 1; }",
            "command -v codex >/dev/null || { printf \"%s\\n\" \"Install Codex: https://developers.openai.com/codex/cli\" >&2; exit 1; }",
            "installation=$(node --input-type=module - " + Quote(version) + " <<'NODE'",
            "import { lstatSync, mkdirSync, realpathSync } from \"node:fs\";", "import { homedir } from \"node:os\";", "import { join } from \"node:path\";",
            "let directory = realpathSync(homedir());", "for (const part of [\".local\", \"share\", \"ctlflow\", \"releases\", process.argv[2]]) {",
            "  directory = join(directory, part);", "  try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== \"EEXIST\") throw error; }",
            "  const stat = lstatSync(directory);", "  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o022)) throw new Error(\"Unsafe private installation directory\");",
            "}", "console.log(directory);", "NODE", ")",
            "npm install --prefix \"$installation\" --ignore-scripts --omit=dev --no-audit --no-fund --save-exact " + Quote("@ctlflow/fleet@" + version),
            "\"$installation/node_modules/.bin/fleet\" setup --descriptor " + Quote(DescriptorUrl(origin, owner))
        });
    public static string Guide(string origin, string owner, string version, string instructions)
    {
        var text = new StringBuilder();
        foreach (var line in new[]
        {
            "# Set up a Crossfire agent", "",
            "Crossfire lets people message managed agents through Matrix. fleetd owns each agent’s native session and the shared listener; a single agent is an ordinary one-agent fleet.",
            "Server: " + origin, "Verified human owner: " + owner, "", "## 1. Check prerequisites",
            "Use the human-selected project directory on Linux or macOS. Requires Node.js 26+, npm, Git, Bash and Codex. Check node --version, npm --version, git --version and codex --version. The controller performs model-free native capability and authentication checks before enrolling or starting an agent.",
            "If something is missing, help install it within the human’s normal permission policy. Official installation instructions: https://nodejs.org/en/download ; https://git-scm.com/downloads ; https://developers.openai.com/codex/cli . Provider login uses native Codex authentication. Never request Matrix passwords, administrator tokens, ports or session IDs. Do not silently use sudo, change host services or install global skills.",
            "This coding session only performs setup. It stays independent: its process, conversation and project-native settings are not adopted or imported. fleetd creates a separate managed session. Subsequent resume and wake reuse that managed session’s saved histories. Linux inert-provider checks are not macOS or paid-provider certification.",
            "", "## 2. Run the complete setup command",
            "Inspect and run this Bash command from the project directory. It installs the pinned public CLI/controller into private user-owned storage and runs one noninteractive setup operation. It asks no naming, model, controller or room questions. Stable names and state are derived and persisted automatically.",
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
            "Only @ctlflow/fleet and @ctlflow/fleetd are public npm packages. Internal modules stay bundled and private. A new release may notify the managed agent once. With human consent, install the pinned package version into the private installation, run fleet update FLEET_KEY and restart the controller with fleet daemon restart. Explicitly stopped agents remain stopped; running agents resume their saved histories. Read changed skill content after the verified update. Do not replace a live receiver or re-enroll."
        }) text.Append(line).Append('\n');
        if (instructions.Length != 0) text.Append("\n## Instructions from this instance’s administrator\n").Append(instructions).Append('\n');
        return text.ToString();
    }
}
