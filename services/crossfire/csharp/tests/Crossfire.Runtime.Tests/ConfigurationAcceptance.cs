using System.Text;
using System.Text.Json;
using Crossfire.AdapterCodex;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterToml;
using Crossfire.AgentCore;
using Crossfire.Kernel;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public static class ConfigurationAcceptance
{
    private static JsonElement Json(string value) { using var document = JsonDocument.Parse(value); return document.RootElement.Clone(); }
    public static void Verify()
    {
        var parsed = ConfigurationToml.Parse("name = '東京'\n[provider.'with.dot']\napi_key = 'private'\nports = [1, 2, 3]\nenabled = true\n");
        Equal(parsed.IsSuccess, true, "native TOML parser handles quoted dotted keys and nested arrays");
        var formatted = ConfigurationToml.Format(parsed.Value); Equal(formatted.IsSuccess, true, "source-generated TOML formatting");
        Equal(((Dictionary<string, object?>)((Dictionary<string, object?>)ConfigurationToml.Parse(formatted.Value).Value["provider"]!)["with.dot"]!)["api_key"] as string, "private", "TOML roundtrip preserves provider values");
        Equal(ConfigurationToml.Parse("duplicate = 1\nduplicate = 2\n").IsSuccess, false, "TOML duplicate keys are refused");
        Equal(ConfigurationToml.Parse("value = [\n").IsSuccess, false, "malformed TOML is refused");
        Equal(ConfigurationToml.Parse(new string(' ', 1048577)).IsSuccess, false, "configuration byte bound precedes parsing");
        var defaults = CodexSettings.Parse(Json("{}")); Equal(defaults.IsSuccess, true, "native options use approved defaults");
        Equal(defaults.Value.Sandbox, "danger-full-access", "native sandbox default"); Equal(defaults.Value.ApprovalPolicy, "on-request", "native human approval default");
        foreach (var effort in new[] { "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra" })
            Equal(CodexSettings.Parse(Json("{\"model_reasoning_effort\":" + ProtocolJson.Quote(effort) + "}")).Value.Effort, effort, "configured effort is not substituted");
        foreach (var input in new[] { "{\"unknown\":true}", "{\"model\":null}", "{\"features\":{\"unknown\":true}}", "{\"features\":{\"default_mode_request_user_input\":1}}", "{\"approval_policy\":\"auto\"}", "{\"model_reasoning_effort\":\"very-high\"}", "{\"dangerously_bypass_approvals_and_sandbox\":true,\"sandbox_mode\":\"read-only\"}", "{\"dangerously_bypass_approvals_and_sandbox\":true,\"approval_policy\":\"on-request\"}" })
            Equal(CodexSettings.Parse(Json(input)).IsSuccess, false, "unknown or conflicting native configuration is rejected");
        Equal(CodexSettings.Parse(Json("{\"features\":{}}")).Value.Native().GetProperty("features").EnumerateObject().Count(), 0, "explicit empty native feature table is preserved");
        Equal(CodexSettings.Parse(Json("{\"dangerously_bypass_approvals_and_sandbox\":true}")).Value.ApprovalPolicy, "never", "explicit dangerous bypass controls approval policy");
        Equal(CodexSettings.Approval(Json("\"never\"")).Value, RuntimeApproval.None, "native never does not ask for listener approval");
        Equal(CodexSettings.Approval(Json("{\"granular\":{\"sandbox_approval\":false,\"rules\":false,\"skill_approval\":true,\"request_permissions\":false,\"mcp_elicitations\":false}}")).Value, RuntimeApproval.Listener, "native granular approval remains native-authoritative");
        Equal(CodexSettings.Approval(Json("{\"granular\":{}}")).IsSuccess, false, "incomplete native approval policy is rejected");
        foreach (var version in new[] { "codex-cli 0.158.0", "codex-cli 0.162.1", "codex-cli 1.0.0" }) Equal(CodexSettings.Version(version).IsSuccess, true, "supported stock Codex version");
        foreach (var version in new[] { "codex-cli 0.157.99", "codex 0.162.1", "codex-cli 0.162.1-extra" }) Equal(CodexSettings.Version(version).IsSuccess, false, "unsupported native version is explicit");
        Homes();
    }
    private static void Homes()
    {
        var directory = PrivateFiles.Directory(Path.Combine(Path.GetTempPath(), "crossfire-native-home-" + Guid.NewGuid().ToString("N")));
        try
        {
            var host = PrivateFiles.Directory(Path.Combine(directory, "host")); var state = PrivateFiles.Directory(Path.Combine(directory, "state"));
            PrivateFiles.Write(Path.Combine(host, "config.toml"), Encoding.UTF8.GetBytes("model='base'\nmodel_provider='fixture'\nprofile='selected'\napproval_policy='never'\n[model_providers.fixture]\nname='Fixture'\nbase_url='http://127.0.0.1:9/v1'\n[profiles.selected]\nmodel='chosen'\nmodel_reasoning_effort='max'\nsandbox_mode='read-only'\n[profiles.unused]\nmodel='ignored'\n"), 1048576);
            File.SetUnixFileMode(Path.Combine(host, "config.toml"), UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.OtherRead);
            var prepared = ManagedHome.Prepare(state, host); Equal(prepared.IsSuccess, true, "managed home copies only native model/provider defaults");
            var home = prepared.Value; var configuration = ManagedHome.ReadConfiguration(home).Value; var profiles = (Dictionary<string, object?>)configuration["profiles"]!;
            Equal(profiles.Count, 1, "unselected native profiles are not copied"); Equal(((Dictionary<string, object?>)profiles["selected"]!)["model"] as string, "chosen", "selected profile model is preserved");
            Equal(configuration.ContainsKey("approval_policy"), false, "host approval does not override managed approval settings");
            Equal(((Dictionary<string, object?>)profiles["selected"]!).ContainsKey("sandbox_mode"), false, "host profile sandbox does not override managed sandbox settings");
            Equal(ManagedHome.Provider(configuration).Value.Id, "fixture", "profile provider remains exact");
            var auth = Path.Combine(host, "auth.json"); PrivateFiles.Write(auth, "{\"fixture\":\"first-account\"}"u8, 65536);
            Equal(ManagedHome.RefreshAuthentication(home, host).IsSuccess, true, "initial authentication refresh");
            PrivateFiles.Write(auth, "{\"fixture\":\"new-account\"}"u8, 65536);
            Equal(ManagedHome.RefreshAuthentication(home, host).IsSuccess, true, "every resume refreshes the current host account");
            Equal(Encoding.UTF8.GetString(PrivateFiles.Read(Path.Combine(home, "auth.json"), 65536)), "{\"fixture\":\"new-account\"}", "resume uses new authentication bytes");
            PrivateFiles.DeletePrivate(auth); Equal(ManagedHome.RefreshAuthentication(home, host).IsSuccess, true, "host logout removes stale managed authentication");
            Equal(PrivateFiles.Exists(Path.Combine(home, "auth.json")), false, "logged-out account is not silently retained");
            Equal(ManagedHome.RefreshAuthentication(home, home).IsSuccess, false, "managed home cannot adopt host login storage");
            var environment = ManagedHome.NativeEnvironment(home, state, "immutable-profile");
            Equal(environment["CODEX_THREAD_ID"] is null, true, "setup never adopts the caller native thread"); Equal(environment["CROSSFIRE_AGENT_NAME"], "immutable-profile", "native tool identity is controller-assigned");
            var link = Path.Combine(directory, "linked-state"); Directory.CreateSymbolicLink(link, state);
            try { ManagedHome.Directories(host, link); throw new InvalidOperationException("linked state was accepted"); } catch (IOException) { }
            Equal(ManagedHome.ReadConfiguration(host).IsSuccess, true, "owned read-only configuration is accepted");
            File.SetUnixFileMode(Path.Combine(host, "config.toml"), UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.GroupWrite);
            Equal(ManagedHome.ReadConfiguration(host).IsSuccess, false, "shared-write host configuration is rejected");
        }
        finally { Directory.Delete(directory, recursive: true); }
    }
}
