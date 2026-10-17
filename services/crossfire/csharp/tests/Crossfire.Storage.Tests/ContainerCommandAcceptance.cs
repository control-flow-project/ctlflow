using Crossfire.Server;
using Crossfire.Kernel;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class ContainerCommandAcceptance
{
    public static async Task Verify()
    {
        foreach (var command in new[] { "create", "stop", "rm" }) Equal(ContainerCommands.CaptureTimeout([command, "fixture"]), 120000, "Docker lifecycle mutation has a finite creation/removal budget");
        string[][] probes = [["info"], ["image", "inspect"], ["container", "ls"], ["container", "inspect"]];
        foreach (var command in probes) Equal(ContainerCommands.CaptureTimeout(command), 30000, "Docker metadata probes retain their finite short budget");
        foreach (var option in new[] { "--source", "--runtime", "--compile" })
        {
            var rejected = false; try { await ServerOperator.Run(["start", option, "old"]); } catch (ArgumentException) { rejected = true; }
            Equal(rejected, true, "superseded source-build deployment options are rejected");
        }
        var resources = ContainerCommands.Resources("crossfire-test.slice");
        var server = ContainerCommands.Server("/private/example", "fixture-image", "crossfire-example", 8098, 8099, resources);
        var migration = ContainerCommands.Migration("/private/example", "fixture-image", resources);
        Equal(server.Contains("--rm"), false, "server has one explicit lifecycle owner");
        Equal(migration.Contains("--rm"), false, "migration has one explicit lifecycle owner");
        Equal(server.Contains("127.0.0.1:8098:8080") && server.Contains("127.0.0.1:8099:8082"), true, "only explicit loopback ports are exposed");
        Equal(migration.Contains("--network") && migration.Contains("none") && !migration.Contains("--publish"), true, "migration stays network isolated");
        var digest = new string('a', 64); var image = "sha256:" + new string('b', 64); var migrations = "sha256:" + new string('c', 64);
        var manifest = "{\"schemaVersion\":1,\"version\":\"0.1.20\",\"sourceDigest\":\"" + digest + "\",\"backend\":\"csharp-nativeaot\",\"platform\":\"linux/amd64\",\"archiveSha256\":\"" + digest + "\",\"runtimeImage\":\"" + image + "\",\"migrationImage\":\"" + migrations + "\"}";
        var package = ContainerPackage.Parse(WireJson.Parse(System.Text.Encoding.UTF8.GetBytes(manifest)));
        Equal(package.RuntimeImage, image, "package retains immutable image ID"); Equal(package.MigrationImage, migrations, "one shared Knex image");
        Equal(ContainerPackage.Parse(WireJson.Parse(System.Text.Encoding.UTF8.GetBytes(manifest.Replace("csharp-nativeaot", "rust", StringComparison.Ordinal)))).Backend, "rust", "package format is backend independent");
        foreach (var changed in new[] { manifest.Replace("linux/amd64", "linux/arm64", StringComparison.Ordinal), manifest.Replace("csharp-nativeaot", "../node", StringComparison.Ordinal), manifest.Replace("csharp-nativeaot", "migrations", StringComparison.Ordinal), manifest.Replace(image, "mutable:latest", StringComparison.Ordinal), manifest.Replace(migrations, image, StringComparison.Ordinal), manifest.Replace("\"schemaVersion\":1", "\"schemaVersion\":2", StringComparison.Ordinal), manifest.Replace("\"version\":\"0.1.20\"", "\"version\":\"\"", StringComparison.Ordinal) })
        {
            var rejected = false; try { ContainerPackage.Parse(WireJson.Parse(System.Text.Encoding.UTF8.GetBytes(changed))); } catch (ArgumentException) { rejected = true; }
            Equal(rejected, true, "invalid package cannot select another identity or platform");
        }
        foreach (var option in new[] { "--rm", "--rm=true", "--rm=false" })
        {
            var rejected = false;
            try { await ContainerLifecycle.Owned(["run", option, "--name", "fixture"], "/", CancellationToken.None); }
            catch (ArgumentException) { rejected = true; }
            Equal(rejected, true, "automatic removal is rejected rather than competing with explicit cleanup");
        }
        await Removal();
    }

    private static async Task Removal()
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException("Container lifecycle acceptance requires Linux");
        var directory = Directory.CreateTempSubdirectory("crossfire-removal-").FullName;
        var previous = Environment.GetEnvironmentVariable("PATH"); var identity = new string('a', 64);
        var state = Path.Combine(directory, "state"); var mode = Path.Combine(directory, "mode"); var observations = Path.Combine(directory, "observations"); var calls = Path.Combine(directory, "calls");
        var docker = Path.Combine(directory, "docker");
        File.WriteAllText(docker, $$"""
#!/bin/sh
phase=$(/bin/cat '{{state}}')
printf '%s\n' "$*" >> '{{calls}}'
case "$1 $2" in
  'create --name') printf '%s\n' '{{identity}}'; exit 0 ;;
  'start --attach') echo 'primary operation failed' >&2; exit 17 ;;
  'stop --timeout') phase=exited ;;
  'rm {{identity}}')
    selected=$(/bin/cat '{{mode}}')
    if [ "$selected" = denied ]; then echo 'permission denied' >&2; exit 1; fi
    printf removing > '{{state}}'
    if [ "$selected" = in-progress ]; then exit 1; fi
    exit 0 ;;
  'container ls')
    if [ "$phase" = removing ]; then
      count=$(/bin/cat '{{observations}}'); count=$((count + 1)); printf '%s' "$count" > '{{observations}}'
      if [ "$count" -gt 2 ]; then phase=missing; fi
    fi
    if [ "$phase" != missing ]; then printf '%s\n' '{{identity}}'; fi ;;
  'container inspect') printf '%s\n' "$phase" ;;
esac
printf '%s' "$phase" > '{{state}}'
""");
        File.SetUnixFileMode(docker, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        try
        {
            Environment.SetEnvironmentVariable("PATH", directory + ":" + previous);
            foreach (var phase in new[] { "missing", "removing", "running" }) foreach (var selected in new[] { "normal", "in-progress" })
            {
                File.WriteAllText(state, phase); File.WriteAllText(mode, selected); File.WriteAllText(observations, "0"); File.WriteAllText(calls, "");
                await ContainerLifecycle.Remove(identity, directory, CancellationToken.None);
                var recorded = File.ReadAllLines(calls);
                Equal(recorded.Count(line => line.StartsWith("rm ", StringComparison.Ordinal)), phase == "running" ? 1 : 0, "removal has one initiator");
                Equal(recorded.Count(line => line.StartsWith("stop ", StringComparison.Ordinal)), phase == "running" ? 1 : 0, "existing removal is never stopped again");
                Equal(File.ReadAllText(state), "missing", "absence confirms completed removal");
            }
            File.WriteAllText(state, "running"); File.WriteAllText(mode, "denied"); File.WriteAllText(observations, "0"); File.WriteAllText(calls, "");
            var rejected = false; try { await ContainerLifecycle.Remove(identity, directory, CancellationToken.None); } catch (IOException error) { rejected = error.Message.Contains("permission denied", StringComparison.Ordinal); }
            Equal(rejected, true, "an actual deletion failure cannot be reported as successful cleanup");
            rejected = false;
            try { await ContainerLifecycle.Owned(["run", "--name", "fixture"], directory, CancellationToken.None); }
            catch (IOException error) { rejected = error.InnerException is AggregateException both && both.InnerExceptions.Count == 2
                && both.InnerExceptions[0].Message.Contains("exit 17", StringComparison.Ordinal)
                && both.InnerExceptions[1].Message.Contains("permission denied", StringComparison.Ordinal); }
            Equal(rejected, true, "container cleanup retains both the primary operation and cleanup failures");
        }
        finally { Environment.SetEnvironmentVariable("PATH", previous); Directory.Delete(directory, true); }
    }
}
