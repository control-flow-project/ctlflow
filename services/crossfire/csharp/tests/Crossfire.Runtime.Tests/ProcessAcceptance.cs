using System.Diagnostics;
using Crossfire.AdapterProcess;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public static class ProcessAcceptance
{
    public static async Task Verify()
    {
        var environment = new Dictionary<string, string?> { ["CROSSFIRE_NATIVE_FIXTURE"] = "exact-private-value" }; var workspace = Path.GetTempPath();
        var result = await NativeProcess.Capture(new("/bin/sh", ["-c", "printf '%s' \"$CROSSFIRE_NATIVE_FIXTURE\"; printf 'native-error' >&2; exit 7"], workspace, environment), 4096, 5000, CancellationToken.None);
        Equal(result.IsSuccess, true, "bounded native command collection"); Equal(result.Value.ExitCode, 7, "nonzero native exit is not reported as a transport failure");
        Equal(result.Value.Output, "exact-private-value", "explicit private environment reaches only the child"); Equal(result.Value.Errors, "native-error", "native stderr stays separate");
        var overflow = await NativeProcess.Capture(new("/usr/bin/head", ["-c", "1100", "/dev/zero"], workspace, environment), 128, 5000, CancellationToken.None);
        Equal(overflow.IsSuccess, false, "native output collection cannot grow without bound");
        var unicode = await NativeProcess.Capture(new("/usr/bin/printf", ["%s", string.Concat(Enumerable.Repeat("😀", 32))], workspace, environment), 128, 5000, CancellationToken.None);
        Equal(unicode.IsSuccess && unicode.Value.Output.Length == 64, true, "native output bounds count actual UTF-8 bytes without splitting surrogate pairs");
        var malformed = await NativeProcess.Capture(new("/bin/sh", ["-c", "printf '\\377'"], workspace, environment), 128, 5000, CancellationToken.None);
        Equal(malformed.IsSuccess, false, "invalid native UTF-8 is not silently replaced");
        var opened = NativeProcess.Start(new("/bin/sh", ["-c", "printf '%s\\n' \"$$\"; read answer; printf '%s' \"$answer\""], workspace, environment, Input: true));
        Equal(opened.IsSuccess, true, "owned native process starts independently of any terminal");
        await using (var process = opened.Value)
        {
            var pid = await process.Output.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5)); Equal(pid, process.Id.ToString(System.Globalization.CultureInfo.InvariantCulture), "setsid exec retains the owned native PID");
            await process.Input.WriteLineAsync("native input"); await process.Input.FlushAsync(); await process.Ended.WaitAsync(TimeSpan.FromSeconds(5));
            Equal(await process.Output.ReadToEndAsync(), "native input", "native stdin remains available only when explicitly selected");
        }
        var controlled = NativeProcess.Start(new("/bin/sh", ["-c", "printf 'ready\\n'; read answer"], workspace, environment, Input: true));
        Equal(controlled.IsSuccess, true, "owned native lifetime fixture"); var owner = controlled.Value;
        Equal(await owner.Output.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5)), "ready", "native process readiness is observed rather than slept for");
        await Task.WhenAll(owner.DisposeAsync().AsTask(), owner.DisposeAsync().AsTask()).WaitAsync(TimeSpan.FromSeconds(5));
        Equal(owner.Ended.IsCompletedSuccessfully, true, "owned process termination waits for actual exit");
        var orphaned = NativeProcess.Start(new("/bin/sh", ["-c", "exec 5<&0; /bin/sh -c 'trap \"\" TERM; printf \"child-ready\\n\"; read answer <&5' & exit 0"], workspace, environment, Input: true));
        Equal(orphaned.IsSuccess, true, "native child-group ownership fixture");
        await using (var process = orphaned.Value)
        {
            Equal(await process.Output.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5)), "child-ready", "a native tool remains alive after its direct parent exits");
            await process.Ended.WaitAsync(TimeSpan.FromSeconds(5)); await process.StopAsync();
            Equal(await process.Output.ReadToEndAsync().WaitAsync(TimeSpan.FromSeconds(5)), "", "shutdown also kills remaining group members even after parent exit");
        }
    }
}
