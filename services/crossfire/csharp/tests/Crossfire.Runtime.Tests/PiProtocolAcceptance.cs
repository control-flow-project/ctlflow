using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterPi;
using Crossfire.Kernel;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public static class PiProtocolAcceptance
{
    private const string Fixture = "#!/usr/bin/env node\n" + """
        import { createInterface } from 'node:readline';
        if (process.argv.includes('--version')) { console.log('1.0.0'); process.exit(0); }
        const pending = new Map();
        const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
        const reply = value => emit({type:'response',id:value.id,command:value.type,success:true,data:{exact:value.type}});
        const input = createInterface({input:process.stdin});
        input.on('line', line => {
          const value = JSON.parse(line);
          if (value.type === 'hold' || value.type === 'get_state' || value.type === 'get_available_models') { pending.set(value.id,value); emit({type:'fixture-held',id:value.id}); return; }
          if (value.type === 'release_all') { for (const held of pending.values()) reply(held); pending.clear(); if(value.id) reply(value); return; }
          if (value.type === 'mismatch') { emit({type:'response',id:value.id,command:'wrong-command',success:true,data:{}}); return; }
          if (value.type === 'malformed') { process.stdout.write('[]\n'); return; }
          if (value.type === 'invalid_utf8') { process.stdout.write(Buffer.from([0xc0,0xaf,10])); return; }
          if (value.type === 'prompt') {
            const request = JSON.parse(Buffer.from(value.message.slice('/crossfire-control '.length),'base64url').toString('utf8'));
            emit({type:'extension_ui_request',method:'notify',message:JSON.stringify({crossfire:true,id:request.id,data:{operation:request.operation}})});
          }
          reply(value);
        });
        """;
    private static async Task<PiProtocol> Open(string directory, Channel<JsonElement> events, ManualTime? clock = null)
    {
        var binary = Path.Combine(directory, "fixture.mjs"); PrivateFiles.Write(binary, Encoding.UTF8.GetBytes(Fixture), 65536); File.SetUnixFileMode(binary, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        var home = PrivateFiles.Directory(Path.Combine(directory, "home-" + Identity.Identifier())); var history = Path.Combine(home, "reserved.jsonl"); PrivateFiles.Write(history, [], 1);
        var selected = await PiProtocol.Start(binary, home, directory, directory, "pi-protocol-fixture", history, "No model work.", value => events.Writer.TryWrite(value), CancellationToken.None, 10000, clock);
        Equal(selected.IsSuccess, true, selected.IsSuccess ? "bounded Pi protocol test double starts independently of native-provider acceptance" : selected.Error.Message); return selected.Value;
    }
    private static async Task<JsonElement> Receive(Channel<JsonElement> events) => await events.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5));
    public static async Task Verify()
    {
        var directory = PrivateFiles.Directory(Path.Combine(Path.GetTempPath(), "crossfire-pi-protocol-" + Identity.Identifier()));
        try
        {
            var events = Channel.CreateUnbounded<JsonElement>(); var clock = new ManualTime();
            await using (var native = await Open(directory, events, clock))
            {
                Equal(PiValues.Text((await native.Request("ordinary", PiValues.Empty())).Value, "exact"), "ordinary", "Pi ordinary response remains correlated");
                Equal(PiValues.Text((await native.Control("native-operation", PiValues.Empty())).Value, "operation"), "native-operation", "Pi owned control correlation stays separate from ordinary RPC");
                using var cancelled = new CancellationTokenSource(); var waiting = native.Request("hold", PiValues.Empty(), cancelled.Token).AsTask(); await Receive(events); cancelled.Cancel();
                Equal((await waiting).IsSuccess, false, "cancelled Pi response wait cannot claim delivery");
                Equal((await native.Request("release_all", PiValues.Empty())).IsSuccess, true, "a late Pi response is retained and does not corrupt the next request");
                Equal(native.Lifetime.IsCancellationRequested, false, "late Pi correlation does not close a healthy owner");
                Equal((await native.Request("invalid", ModelAcceptance.Json("[]"))).IsSuccess, false, "Pi rejects non-object parameters before registration");
                Equal((await native.Request("cancelled-before-write", PiValues.Empty(), cancelled.Token)).IsSuccess, false, "pre-cancelled Pi request is never written");
                var oversized = PiValues.Object(writer => writer.WriteString("value", new string('x', PiProtocol.MaximumFrame)));
                Equal((await native.Request("oversized", oversized)).IsSuccess, false, "Pi outgoing byte budget is enforced before writing");
                clock.Advance(TimeSpan.FromSeconds(11)); Equal(native.Lifetime.IsCancellationRequested, false, "rejected unsent Pi requests leave no later destructive timeout");
                var pending = new List<Task<Result<JsonElement>>>();
                for (var index = 0; index < 64; index++) { pending.Add(native.Request("hold", PiValues.Empty()).AsTask()); await Receive(events); }
                Equal((await native.Request("over-capacity", PiValues.Empty())).IsSuccess, false, "Pi request capacity is finite and does not admit another writer");
                Equal((await native.Notify(PiValues.Object(writer => writer.WriteString("type", "release_all")))).IsSuccess, true, "Pi control can release bounded requests without adding another correlation");
                Equal((await Task.WhenAll(pending).WaitAsync(TimeSpan.FromSeconds(5))).All(value => value.IsSuccess), true, "every admitted Pi request receives its exact native response");
                Equal(native.Lifetime.IsCancellationRequested, false, "Pi capacity rejection does not masquerade as process failure");
            }
            foreach (var invalid in new[] { "mismatch", "malformed", "invalid_utf8" })
            {
                await using var native = await Open(directory, Channel.CreateUnbounded<JsonElement>());
                Equal((await native.Request(invalid, PiValues.Empty()).AsTask().WaitAsync(TimeSpan.FromSeconds(5))).IsSuccess, false, "invalid native Pi response releases the original waiter as failure");
                Equal(native.Lifetime.IsCancellationRequested, true, "invalid Pi protocol cannot be silently treated as readiness");
            }
            foreach (var metadata in new[] { "get_state", "get_available_models" })
            {
                events = Channel.CreateUnbounded<JsonElement>(); clock = new();
                await using var native = await Open(directory, events, clock);
                using var cancelled = new CancellationTokenSource();
                var waiting = native.Request(metadata, PiValues.Empty(), cancelled.Token).AsTask(); await Receive(events); cancelled.Cancel();
                Equal((await waiting).IsSuccess, false, "Cancelled metadata inspection returns unknown");
                clock.Advance(TimeSpan.FromSeconds(11)); Equal(native.Lifetime.IsCancellationRequested, false, "Cancelled diagnostic metadata cannot later terminate the native owner");
                Equal((await native.Request("release_all", PiValues.Empty())).IsSuccess, true, "Late metadata responses do not corrupt the active session");
                waiting = native.Request(metadata, PiValues.Empty()).AsTask(); await Receive(events); clock.Advance(TimeSpan.FromSeconds(11));
                Equal((await waiting.WaitAsync(TimeSpan.FromSeconds(5))).IsSuccess, false, "Metadata timeout is bounded");
                Equal(native.Lifetime.IsCancellationRequested, false, "Read-only metadata timeout does not terminate an agent");
                Equal((await native.Request("release_all", PiValues.Empty())).IsSuccess, true, "Timed-out metadata leaves the same native process usable");
            }
            events = Channel.CreateUnbounded<JsonElement>(); clock = new();
            await using (var native = await Open(directory, events, clock))
            {
                var waiting = native.Request("hold", PiValues.Empty()).AsTask(); await Receive(events); clock.Advance(TimeSpan.FromSeconds(11));
                Equal((await waiting.WaitAsync(TimeSpan.FromSeconds(5))).IsSuccess, false, "Pi native deadline is tested through a controlled clock"); Equal(native.Lifetime.IsCancellationRequested, true, "uncertain Pi timeout stops the exact native owner instead of resubmitting");
            }
        }
        finally { Directory.Delete(directory, recursive: true); }
    }
}
