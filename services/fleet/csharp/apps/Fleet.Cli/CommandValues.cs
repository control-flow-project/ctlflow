using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Client = Fleet.DaemonClient.DaemonClient;

namespace Fleet.Cli;

public sealed class CommandFailure(string message) : Exception(message);
public sealed record Arguments(IReadOnlyList<string> Positionals, IReadOnlyDictionary<string, string> Options)
{
    public string? Option(string key) => Options.GetValueOrDefault(key);
    public bool Has(string key) => Options.ContainsKey(key);
}
public static class CommandValues
{
    public static T Value<T>(Result<T> result) => result.IsSuccess ? result.Value : throw new CommandFailure(result.Error.Code + ": " + result.Error.Message);
    public static void Output(JsonElement value) => Console.Write(WireJson.Pretty(value));
    public static string Name(string? value) => value is not null && IdentitySyntax.Name(value) ? value : throw new CommandFailure("Use a valid configured name");
    public static string Identifier(string? value) => value is null ? Identity.Identifier() : Validation.Identifier(value) ? value : throw new CommandFailure("Use a UUID for the operation or message identity");
    public static JsonElement Object(Action<ProtocolWriter> fields) => WireJson.Object(fields);
    public static string Text(JsonElement value, string name) => WireJson.Text(value, name) ?? throw new CommandFailure("Daemon returned invalid " + name);
    public static long Number(JsonElement value, string name) => value.TryGetProperty(name, out var field) && Validation.Integer(field).IsSuccess ? field.GetInt64() : throw new CommandFailure("Daemon returned invalid " + name);
    public static bool Boolean(JsonElement value, string name) => value.TryGetProperty(name, out var field) && field.ValueKind is JsonValueKind.True or JsonValueKind.False ? field.GetBoolean() : throw new CommandFailure("Daemon returned invalid " + name);
    public static ValueTask<Result<JsonElement>> Call(Client client, string operation, CancellationToken cancellation, JsonElement? body = null, IReadOnlyDictionary<string, string>? parameters = null, IReadOnlyDictionary<string, string>? query = null)
        => client.Call(operation, parameters, body, cancellation, query);
    public static Arguments Parse(string[] arguments)
    {
        var options = new Dictionary<string, string>(StringComparer.Ordinal); var positionals = new List<string>(); var strings = new HashSet<string>(["root", "remote", "name", "descriptor", "config", "ssh", "definition", "context", "text", "message-id", "operation-id", "release-directory"], StringComparer.Ordinal);
        var literal = false;
        for (var index = 0; index < arguments.Length; index++)
        {
            var argument = arguments[index]; if (literal || !argument.StartsWith('-')) { positionals.Add(argument); continue; } if (argument == "--") { literal = true; continue; }
            if (!argument.StartsWith("--", StringComparison.Ordinal)) throw new CommandFailure("Unknown option " + argument); var separator = argument.IndexOf('='); var key = separator < 0 ? argument[2..] : argument[2..separator]; string value;
            if (key is "help" or "fresh-history") { if (separator >= 0) throw new CommandFailure("Boolean option --" + key + " takes no value"); value = "true"; }
            else if (!strings.Contains(key)) throw new CommandFailure("Unknown option --" + key);
            else if (separator >= 0) value = argument[(separator + 1)..];
            else { if (index + 1 >= arguments.Length || arguments[index + 1].StartsWith("--", StringComparison.Ordinal)) throw new CommandFailure("Missing value for --" + key); value = arguments[++index]; }
            if (!options.TryAdd(key, value) || value.Length == 0) throw new CommandFailure("Duplicated or empty option --" + key);
        }
        var command = positionals.FirstOrDefault(); var action = positionals.ElementAtOrDefault(1); var allowed = new HashSet<string>(["root", "remote", "help"], StringComparer.Ordinal);
        if (command == "remote") allowed.Add("ssh"); if (command == "setup") allowed.UnionWith(["descriptor", "config"]); if (command == "daemon" && action == "start") allowed.Add("name");
        if (command == "agent" && action == "add") allowed.Add("definition"); if (command == "agent" && action == "attach") allowed.Add("context");
        if (command is "enroll" or "start" or "stop" or "update" || command == "agent" && action is "start" or "stop" or "update") allowed.Add("operation-id");
        if (command == "update" || command == "agent" && action == "update") allowed.Add("release-directory"); if (command == "start" || command == "agent" && action == "start") allowed.Add("fresh-history"); if (command == "message") allowed.UnionWith(["text", "message-id"]);
        if (options.Keys.Any(key => !allowed.Contains(key))) throw new CommandFailure("An option is not valid for this command");
        if (!options.ContainsKey("help") && positionals.Count != 0)
        {
            if (options.TryGetValue("operation-id", out var operation)) Identifier(operation);
            if (options.TryGetValue("name", out var label) && !Validation.Text(WireJson.Build(writer => writer.WriteStringValue(label)), 100).IsSuccess) throw new CommandFailure("Invalid controller name");
            var agentStart = command == "agent" && action == "start";
            if (command == "start" || agentStart)
            {
                if (positionals.Count != (agentStart ? 4 : 2)) throw new CommandFailure(Usage);
                var fleet = positionals[agentStart ? 2 : 1];
                if (!IdentitySyntax.Name(fleet) && !IdentitySyntax.Identifier(fleet)) throw new CommandFailure("Use a configured fleet key or UUID");
                if (agentStart) Name(positionals[3]);
            }
            if (command == "daemon" && action == "start" && positionals.Count != 2) throw new CommandFailure(Usage);
        }
        return new(positionals, options);
    }
    public const string Usage = """
fleet setup [--descriptor PERSONALIZED_SETUP_URL] [--config /absolute/runtime.toml] [--root DIRECTORY]
fleet daemon start [--name NAME] [--root DIRECTORY]
fleet daemon status|stop|restart --root DIRECTORY
fleet remote add NAME --ssh USER@HOST --root DIRECTORY
fleet [--root DIRECTORY | --remote NAME] add DIRECTORY
fleet [--root DIRECTORY | --remote NAME] list|show|test|enroll|start|stop|remove [FLEET]
fleet [--root DIRECTORY | --remote NAME] diagnose [FLEET]
fleet [--root DIRECTORY | --remote NAME] agent diagnose FLEET INSTANCE
fleet [--root DIRECTORY | --remote NAME] start FLEET [--fresh-history] [--operation-id UUID]
fleet [--root DIRECTORY | --remote NAME] stop FLEET [--operation-id UUID]
fleet [--root DIRECTORY | --remote NAME] update FLEET [--operation-id UUID] [--release-directory DIRECTORY]
fleet [--root DIRECTORY | --remote NAME] activate|deactivate FLEET
fleet [--root DIRECTORY | --remote NAME] message FLEET --text TEXT [--message-id UUID]
fleet agent list FLEET
fleet agent add FLEET INSTANCE --definition DEFINITION
fleet agent start FLEET INSTANCE [--fresh-history] [--operation-id UUID]
fleet agent stop FLEET INSTANCE [--operation-id UUID]
fleet agent update FLEET INSTANCE [--operation-id UUID] [--release-directory DIRECTORY]
fleet agent remove|contexts FLEET INSTANCE
fleet agent attach FLEET INSTANCE [--context CONTEXT]

Start resumes retained history; --fresh-history explicitly replaces it.
Stop clears selected bindings' desired activation and retains their histories.
Daemon shutdown preserves desired activation for the next daemon start.
Contexts lists saved histories without waking stopped or sleeping agents.
Attach prints a terminal pointer for an already running native session.
""";
}
