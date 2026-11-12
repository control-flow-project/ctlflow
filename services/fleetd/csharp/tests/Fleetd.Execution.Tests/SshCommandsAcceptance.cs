using Crossfire.AdapterFilesystem;
using Crossfire.AdapterProcess;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.AdapterExecution.Vm;

static class SshCommandsAcceptance
{
    public static async Task Run(string root, Action<bool, string> check)
    {
        var id = Identity.Identifier();
        var master = SshCommands.Master(root, id, 31234);
        check(master.IsSuccess && master.Value.Arguments.Contains("StrictHostKeyChecking=yes"), "VM host key must be pinned");
        check(master.IsSuccess && master.Value.Arguments.Contains("SendEnv=" + SshCommands.ProviderSecret), "Multiplex master permits only the reserved selected-provider environment channel");
        check(master.IsSuccess && master.Value.Environment.TryGetValue(SshCommands.ProviderSecret, out var ambient) && ambient is null, "SSH master never inherits an ambient provider channel value");
        check(master.IsSuccess && master.Value.Arguments.Contains("127.0.0.1:31234:127.0.0.1:31234"), "Only the same own listener port is reverse-forwarded");
        var withoutTools = SshCommands.Master(root, id, null);
        check(withoutTools.IsSuccess && !withoutTools.Value.Arguments.Contains("-R"), "Inspection without a listener creates no reverse forwarding");
        check(!SshCommands.Master(root, id, 0).IsSuccess && !SshCommands.Master("/tmp/space directory", id, null).IsSuccess,
            "Invalid ports and ambiguous SSH configuration paths are rejected");
        var workspace = PrivateFiles.Directory(Path.Combine(root, "reader's研究"));
        const string argument = "literal ' quote \" and $(touch injected) `touch injected`\nnext";
        const string program = "import os,json,sys;print(json.dumps({'cwd':os.getcwd(),'args':sys.argv[1:],'environment':dict(os.environ)}))";
        var placed = SshCommands.Place(root, id, new("/usr/bin/python3", ["-c", program, argument], workspace,
            new Dictionary<string, string?> { ["CODEX_HOME"] = workspace + "/.codex", ["PATH"] = "/untrusted", ["HOST_SECRET"] = "not-authorized",
                ["LD_PRELOAD"] = "/untrusted", ["CODEX_THREAD_ID"] = "wrong-context", ["CROSSFIRE_AGENT_NAME"] = "analyst's研究",
                ["FLEET_RUNTIME_AUTH_TOKEN"] = "foreign-native-token", ["OPENAI_API_KEY"] = "foreign-provider-key" }, true));
        check(placed.IsSuccess && placed.Value.Input, "Selected guest commands preserve native stdio");
        if (!placed.IsSuccess) throw new IOException(placed.Error.Message);
        check(placed.Value.Arguments.Contains("ProxyCommand=/usr/bin/false") && placed.Value.Arguments.Contains("ControlMaster=no"),
            "A missing multiplex connection cannot start another physical connection");
        var output = await NativeProcess.Capture(new("/bin/sh", ["-c", placed.Value.Arguments[^1]], root,
            new Dictionary<string, string?> { ["HOST_SECRET"] = "ambient-secret" }), 32768, 5000, CancellationToken.None);
        check(output.IsSuccess && output.Value.ExitCode == 0, "Actual shell executes the safely quoted guest command");
        if (!output.IsSuccess || output.Value.ExitCode != 0) throw new IOException(output.IsSuccess ? output.Value.Errors : output.Error.Message);
        var value = WireJson.Parse(System.Text.Encoding.UTF8.GetBytes(output.Value.Output)); var environment = value.GetProperty("environment");
        check(value.GetProperty("cwd").GetString() == workspace && value.GetProperty("args")[0].GetString() == argument, "Unicode, quotes and shell metacharacters retain their literal values");
        check(!File.Exists(Path.Combine(workspace, "injected")), "Native arguments never execute as shell fragments");
        check(!environment.TryGetProperty("HOST_SECRET", out _) && !environment.TryGetProperty("LD_PRELOAD", out _)
            && !environment.TryGetProperty("CODEX_THREAD_ID", out _) && !environment.TryGetProperty("FLEET_RUNTIME_AUTH_TOKEN", out _)
            && !environment.TryGetProperty("OPENAI_API_KEY", out _), "Controller secrets and foreign session identity never enter guest environment");
        check(environment.GetProperty("PATH").GetString() == SshCommands.GuestPath && environment.GetProperty("HOME").GetString() == "/root"
            && environment.GetProperty("CODEX_HOME").GetString() == workspace + "/.codex", "Guest image paths and the exact native managed home are selected");
        const string providerSecret = "fixture-key-'\"$(not-a-command)\nsecond-line";
        var providerCommand = new NativeCommand("/usr/bin/python3", ["-c", program], workspace,
            new Dictionary<string, string?> { [SshCommands.ProviderKey] = "SELECTED_PROVIDER_KEY", ["SELECTED_PROVIDER_KEY"] = providerSecret,
                ["OTHER_PROVIDER_KEY"] = "must-not-cross" });
        var provider = SshCommands.Place(root, id, providerCommand);
        check(provider.IsSuccess && provider.Value.Arguments.Contains("SendEnv=" + SshCommands.ProviderSecret)
            && !provider.Value.Arguments.Any(argument => argument.Contains(providerSecret, StringComparison.Ordinal)),
            "The selected provider secret uses SSH channel environment and never command arguments");
        if (!provider.IsSuccess) throw new IOException(provider.Error.Message);
        var delivered = await NativeProcess.Capture(new("/bin/sh", ["-c", provider.Value.Arguments[^1]], root, provider.Value.Environment), 32768, 5000, CancellationToken.None);
        check(delivered.IsSuccess && delivered.Value.ExitCode == 0, "Selected provider environment expansion is literal even with shell syntax");
        if (!delivered.IsSuccess) throw new IOException(delivered.Error.Message);
        var credentials = WireJson.Parse(System.Text.Encoding.UTF8.GetBytes(delivered.Value.Output)).GetProperty("environment");
        check(credentials.GetProperty("SELECTED_PROVIDER_KEY").GetString() == providerSecret
            && !credentials.TryGetProperty("OTHER_PROVIDER_KEY", out _) && !credentials.TryGetProperty(SshCommands.ProviderSecret, out _),
            "Only the explicitly selected native provider key reaches the clean guest environment");
        check(!SshCommands.Place(root, id, providerCommand with { Environment = new Dictionary<string, string?> { [SshCommands.ProviderKey] = "PATH", ["PATH"] = providerSecret } }).IsSuccess,
            "Provider selection cannot override fixed guest execution variables");
        var forward = SshCommands.Forward(root, id, 31235, 31236);
        check(forward.IsSuccess && forward.Value.Arguments.Contains("127.0.0.1:31235:127.0.0.1:31236"), "Native endpoint forwarding binds host and guest loopback only");
        check(!SshCommands.Forward(root, id, 0, 31236).IsSuccess, "Invalid endpoint ports are rejected");
        var checkConnection = SshCommands.Check(root, id);
        if (!checkConnection.IsSuccess) throw new IOException(checkConnection.Error.Message);
        var absent = await NativeProcess.Capture(checkConnection.Value, 8192, 5000, CancellationToken.None);
        check(absent.IsSuccess && absent.Value.ExitCode != 0, "Actual OpenSSH fails when the owned multiplex socket is absent");
        var marker = Path.Combine(root, "must-not-run-on-host");
        var terminal = SshCommands.Terminal(new(root, id), workspace, "/usr/bin/touch '" + marker + "'");
        if (!terminal.IsSuccess) throw new IOException(terminal.Error.Message);
        var refused = await NativeProcess.Capture(new("/bin/sh", ["-c", terminal.Value], root, new Dictionary<string, string?>()),
            8192, 5000, CancellationToken.None);
        check(refused.IsSuccess && refused.Value.ExitCode != 0 && !File.Exists(marker),
            "A missing guest terminal connection never executes the requested command on the host");
    }
}
