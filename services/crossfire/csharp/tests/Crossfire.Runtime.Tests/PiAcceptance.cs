using System.Text;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterPi;
using Crossfire.Kernel;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public static class PiAcceptance
{
    public static async Task Verify()
    {
        var binary = Environment.GetEnvironmentVariable("CROSSFIRE_TEST_PI_EXECUTABLE") ?? throw new InvalidOperationException("Prepare the pinned native Pi executable through verify-runtime.mjs");
        var directory = PrivateFiles.Directory(Path.Combine(Path.GetTempPath(), "crossfire-native-pi-" + Identity.Identifier()));
        try
        {
            var home = PrivateFiles.Directory(Path.Combine(directory, "home")); var workspace = PrivateFiles.Directory(Path.Combine(directory, "workspace"));
            var history = Path.Combine(home, "native.jsonl"); PrivateFiles.Write(history, [], 1);
            using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(60)); var observed = 0;
            var started = await PiProtocol.Start(binary, home, workspace, directory, "native-pi-proof", history, "This is an inert native capability proof. Do not start model work.", _ => Interlocked.Increment(ref observed), stop.Token, 10000);
            Equal(started.IsSuccess, true, started.IsSuccess ? "actual pinned Pi starts through the owned native process port" : started.Error.Message); var native = started.Value;
            await using (native)
            {
                var state = await native.Request("get_state", PiValues.Empty(), stop.Token);
                Equal(state.IsSuccess, true, state.IsSuccess ? "actual Pi RPC request correlation" : state.Error.Message);
                var id = PiValues.Text(state.Value, "sessionId"); Equal(Guid.TryParseExact(id, "D", out _), true, "actual Pi reports its native session UUID");
                Equal(PiValues.Text(state.Value, "sessionFile"), history, "actual Pi keeps the exact preallocated session path");
                var control = await native.Control("state", PiValues.Empty(), stop.Token);
                Equal(control.IsSuccess, true, control.IsSuccess ? "native owned extension control is acknowledged without a model turn" : control.Error.Message);
                Equal(PiValues.Text(control.Value, "sessionId"), id, "native extension control belongs to the exact selected Pi session");
                Equal(control.Value.GetProperty("idle").GetBoolean(), true, "native control does not start model execution");
                const string text = "This is an inert native capability proof. Do not start model work.";
                var injected = await native.Control("instructions", PiValues.Object(writer => { writer.WriteString("text", text); writer.WriteString("digest", Identity.Hash(text)); }), stop.Token);
                Equal(injected.IsSuccess, true, injected.IsSuccess ? "native Pi verifies its exact appended system instructions" : injected.Error.Message);
                var entry = PiValues.Text(injected.Value, "entryId"); var found = false;
                NativeHistory.Since(home, history, null, value =>
                {
                    if (PiValues.Text(value, "type") == "custom" && PiValues.Text(value, "id") == entry && PiValues.Text(value, "customType") == "crossfire-instructions")
                        found = PiValues.Text(value.GetProperty("data"), "text") == text && PiValues.Text(value.GetProperty("data"), "digest") == Identity.Hash(text);
                });
                Equal(found, true, "Pi instructions have actual native history evidence, not only an RPC success");
                Equal((await native.Request("get_state", PiValues.Empty(), stop.Token)).IsSuccess, true, "private control does not corrupt ordinary native RPC correlation");
                Equal(PrivateFiles.Exists(Path.Combine(home, "crossfire-extension.mjs")), true, "the shared native extension is materialized privately");
                Equal(new UTF8Encoding(false, true).GetString(PrivateFiles.Read(Path.Combine(home, "crossfire-extension.mjs"), 1048576)), PiValues.Extension(), "C# uses the exact generated native extension asset");
            }
            Equal(native.Lifetime.IsCancellationRequested, true, "native Pi shutdown retains a stable stopped lifetime");
            Equal((await native.Request("get_state", PiValues.Empty())).IsSuccess, false, "closed Pi transport cannot claim a native response");
            Equal(PiValues.Options(ModelAcceptance.Json("{\"provider\":\"fixture\"}")).IsSuccess, false, "Pi model configuration requires an exact provider/model pair");
            Equal(PiValues.Options(ModelAcceptance.Json("{\"provider\":\"fixture\",\"model\":\"exact\",\"thinking_level\":\"max\"}")).Value.Thinking, "max", "Pi configuration retains the requested reasoning without substitution");
        }
        finally { Directory.Delete(directory, recursive: true); }
    }
}
