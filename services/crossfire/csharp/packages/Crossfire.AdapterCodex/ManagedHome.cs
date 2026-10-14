using System.Collections;
using System.Text;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterToml;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public static class ManagedHome
{
    private static readonly string[] ModelKeys = ["model", "model_provider", "model_reasoning_effort", "model_reasoning_summary", "model_verbosity",
        "model_context_window", "model_auto_compact_token_limit", "model_auto_compact_token_limit_scope", "model_supports_reasoning_summaries",
        "model_catalog_json", "openai_base_url", "chatgpt_base_url"];
    public static string Host => Environment.GetEnvironmentVariable("CODEX_HOME") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
    public static void Directories(string workspace, string state)
    { PrivateFiles.ExistingDirectory(workspace, false); PrivateFiles.ExistingDirectory(state, true); }

    public static Result<Dictionary<string, object?>> ReadConfiguration(string home)
    {
        try
        {
            var file = Path.Combine(home, "config.toml");
            return PrivateFiles.Exists(file) ? ConfigurationToml.Parse(new UTF8Encoding(false, true).GetString(PrivateFiles.ReadConfiguration(file, ConfigurationToml.MaximumBytes)))
                : Result<Dictionary<string, object?>>.Success(new());
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or DecoderFallbackException or ArgumentException)
        { return Results.Fail<Dictionary<string, object?>>("invalid", "Cannot read the owned native configuration as bounded TOML"); }
    }
    private static Dictionary<string, object?> Defaults(Dictionary<string, object?> configuration)
    {
        var selected = new Dictionary<string, object?>(StringComparer.Ordinal); foreach (var key in ModelKeys) if (configuration.TryGetValue(key, out var value)) selected.Add(key, value); return selected;
    }
    public static Result<(string Id, Dictionary<string, object?> Settings)> Provider(Dictionary<string, object?> configuration)
    {
        var selected = configuration;
        if (configuration.TryGetValue("profile", out var profile) && profile is string name && configuration.TryGetValue("profiles", out var profiles)
            && profiles is Dictionary<string, object?> table && table.TryGetValue(name, out var values) && values is Dictionary<string, object?> overrides)
        { selected = new(StringComparer.Ordinal); foreach (var entry in configuration) selected[entry.Key] = entry.Value; foreach (var entry in overrides) selected[entry.Key] = entry.Value; }
        var id = selected.TryGetValue("model_provider", out var provider) ? provider : "openai";
        if (id is not string { Length: > 0 } identity) return Results.Fail<(string, Dictionary<string, object?>)>("invalid", "The native model provider must have an exact configured identity");
        Dictionary<string, object?>? settings = null;
        if (selected.TryGetValue("model_providers", out var providers) && providers is Dictionary<string, object?> definitions && definitions.TryGetValue(identity, out var value)) settings = value as Dictionary<string, object?>;
        return identity is "openai" or "ollama" or "lmstudio" || settings is not null
            ? Result<(string, Dictionary<string, object?>)>.Success((identity, settings ?? new())) : Results.Fail<(string, Dictionary<string, object?>)>("invalid", "The selected native model provider has no configured definition");
    }
    public static Result<string> Prepare(string state, string? host = null)
    {
        try
        {
            PrivateFiles.ExistingDirectory(state, true); var home = PrivateFiles.Directory(Path.Combine(state, ".codex")); var destination = Path.Combine(home, "config.toml");
            if (!PrivateFiles.Exists(destination))
            {
                var read = ReadConfiguration(host ?? Host); if (!read.IsSuccess) return Result<string>.Fail(read.Error);
                var configuration = read.Value; var selected = Defaults(configuration);
                foreach (var key in new[] { "model_providers", "cli_auth_credentials_store" }) if (configuration.TryGetValue(key, out var value)) selected[key] = value;
                if (configuration.TryGetValue("profile", out var profile))
                {
                    if (profile is not string name || !configuration.TryGetValue("profiles", out var profiles) || profiles is not Dictionary<string, object?> table
                        || !table.TryGetValue(name, out var definition) || definition is not Dictionary<string, object?> values) return Results.Fail<string>("invalid", "The selected native configuration profile is not defined");
                    selected["profile"] = name; selected["profiles"] = new Dictionary<string, object?>(StringComparer.Ordinal) { [name] = Defaults(values) };
                }
                var provider = Provider(selected); if (!provider.IsSuccess) return Result<string>.Fail(provider.Error);
                var text = ConfigurationToml.Format(selected); if (!text.IsSuccess) return Result<string>.Fail(text.Error);
                PrivateFiles.Write(destination, Encoding.UTF8.GetBytes(text.Value), ConfigurationToml.MaximumBytes);
            }
            return Result<string>.Success(home);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        { return Results.Fail<string>("invalid", "Cannot prepare a private managed Codex home without changing the host configuration"); }
    }

    public static Result<Unit> RefreshAuthentication(string home, string? host = null)
    {
        try
        {
            var source = host ?? Host; PrivateFiles.ExistingDirectory(home, true);
            if (Path.GetFullPath(source) == home) return Results.Fail<Unit>("invalid", "The host login home must be separate from the managed native home");
            var original = Path.Combine(source, "auth.json"); var destination = Path.Combine(home, "auth.json");
            if (PrivateFiles.Exists(destination)) { using var validated = PrivateFiles.OpenPrivate(destination); }
            if (PrivateFiles.Exists(original))
            {
                var bytes = PrivateFiles.Read(original, 65536); using var document = JsonDocument.Parse(bytes);
                if (document.RootElement.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Invalid native login");
                PrivateFiles.Write(destination, bytes, 65536);
            }
            else PrivateFiles.DeletePrivate(destination);
            return Results.Done();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        { return Results.Fail<Unit>("unauthorized", "Cannot refresh the private native Codex login from the host. Check the host CODEX_HOME and sign in with codex login, then resume. Never paste credentials into chat."); }
    }
    public static IReadOnlyDictionary<string, string?> NativeEnvironment(string home, string state, string? profile = null)
    {
        var values = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables()) if (entry.Key is string key && entry.Value is string value) values[key] = value;
        values["CODEX_HOME"] = home; values["CROSSFIRE_PROJECT"] = state; values["CODEX_THREAD_ID"] = null; values["CROSSFIRE_AGENT_NAME"] = profile;
        return values;
    }
}
