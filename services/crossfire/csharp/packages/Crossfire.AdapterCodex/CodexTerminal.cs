using Crossfire.AdapterFilesystem;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public static class CodexTerminal
{
    public static RuntimeTerminalAdapter Create() => new(Command);
    private static string Quote(string value) => "'" + value.Replace("'", "'\\''", StringComparison.Ordinal) + "'";
    private static Result<string> Command(RuntimeAttachment input)
    {
        var fields = input.Connection; var names = new[] { "endpoint", "tokenFile", "home", "binary", "path" };
        if (input.Runtime != "codex" || !Validation.Identifier(input.SessionId) || !Path.IsPathFullyQualified(input.Workspace) || input.Workspace.Any(char.IsControl)
            || fields.Count != names.Length || names.Any(name => !fields.TryGetValue(name, out var value) || value.Length is < 1 or > 4096 || value.Any(char.IsControl))
            || !Path.IsPathFullyQualified(fields["tokenFile"]) || !Path.IsPathFullyQualified(fields["home"]))
            return Results.Fail<string>("invalid", "Invalid Codex terminal attachment");
        var endpoint = fields["endpoint"]; if (endpoint.Length > 2048) return Results.Fail<string>("invalid", "Invalid Codex terminal endpoint");
        try
        {
            if (endpoint.StartsWith("unix://", StringComparison.Ordinal)) endpoint = "unix://" + PrivateFiles.UnixSocket(endpoint[7..]);
            else
            {
                if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) || uri.Scheme is not ("ws" or "wss") || uri.Host is not ("127.0.0.1" or "localhost" or "[::1]")
                    || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0 || uri.AbsolutePath != "/") return Results.Fail<string>("invalid", "Invalid Codex terminal endpoint");
                endpoint = uri.AbsoluteUri;
            }
            var arguments = new[] { fields["binary"], "--remote", endpoint, "--remote-auth-token-env", "FLEET_RUNTIME_AUTH_TOKEN", "--cd", input.Workspace, "resume", input.SessionId };
            return Result<string>.Success("PATH=" + Quote(fields["path"]) + " CODEX_HOME=" + Quote(fields["home"]) + " FLEET_RUNTIME_AUTH_TOKEN=\"$(cat -- " + Quote(fields["tokenFile"]) + ")\" " + string.Join(' ', arguments.Select(Quote)));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        { return Results.Fail<string>("invalid", "Invalid private Codex terminal endpoint"); }
    }
}
