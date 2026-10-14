using System.Text.Json;
using Crossfire.AdapterCodex;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterRuntime;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public sealed record ProbeInput(string Text, string MessageId) : NativeMessage(Text, MessageId);

public static class DeliveryAcceptance
{
    private static readonly NativeCodec<ProbeInput> Codec = new(value =>
    {
        var fields = Validation.Fields(value, ["text", "messageId"]); if (!fields.IsSuccess) return Result<ProbeInput>.Fail(fields.Error);
        if (value.GetProperty("text").ValueKind != JsonValueKind.String || value.GetProperty("messageId").ValueKind != JsonValueKind.String) return Results.Fail<ProbeInput>("invalid", "Invalid native input");
        var input = new ProbeInput(value.GetProperty("text").GetString()!, value.GetProperty("messageId").GetString()!);
        return NativeJournal<ProbeInput>.ValidateMessage(input).Map(_ => input);
    }, input => CodexJson.Object(writer => { writer.WriteString("text", input.Text); writer.WriteString("messageId", input.MessageId); }));

    public static async Task Verify()
    {
        var directory = PrivateFiles.Directory(Path.Combine(Path.GetTempPath(), "crossfire-native-receipts-" + Guid.NewGuid().ToString("N")));
        try { await Recovery(directory); await Deadline(directory); await ConcurrentAndCancellation(directory); Journal(directory); }
        finally { Directory.Delete(directory, recursive: true); }
    }
    private static PublicationPorts<ProbeInput> Ports(string file, CancellationTokenSource stop, Func<ProbeInput, bool, ValueTask<Result<NativeReceipt>>> received,
        Action<ProbeInput>? published = null, Func<int, CancellationToken, ValueTask>? wait = null)
        => new("same-native-session", RuntimeApproval.None, stop.Token, scope => { scope.ThrowIfCancellationRequested(); return ValueTask.FromResult(Results.Done()); },
            () => ValueTask.FromResult(Result<bool>.Success(false)), (text, id, _) => ValueTask.FromResult(Result<ProbeInput>.Success(new(text, id))),
            (input, _) =>
            {
                Equal(NativeJournal<ProbeInput>.Read(file, "same-native-session", Codec).Value.Pending, input, "native input is durably saved before the native API call");
                published?.Invoke(input); return ValueTask.FromResult(Results.Done());
            }, (input, _, scope, restored) => { scope.ThrowIfCancellationRequested(); return received(input, restored); },
            () => new(stop.CancelAsync()), Wait: wait);

    private static async Task Recovery(string directory)
    {
        var file = Path.Combine(directory, "recovery.json"); var published = 0;
        using (var stop = new CancellationTokenSource())
        {
            var native = Ports(file, stop, (_, _) => ValueTask.FromResult(Results.Fail<NativeReceipt>("unavailable", "Connection stopped before history could confirm receipt")), _ => published++);
            var opened = NativeDelivery<ProbeInput>.Open(native, Codec, file, 100); Equal(opened.IsSuccess, true, "native delivery owner opens its private journal");
            await using var delivery = opened.Value;
            Equal((await delivery.Deliver("room message with source attribution", "message-one")).IsSuccess, false, "unconfirmed publication does not claim delivery");
            Equal(delivery.Unsettled, true, "uncertain native input remains recoverable");
            Equal((await delivery.Deliver("restart notice", "different-message")).Error.Code, "conflict", "restart notice cannot replace original unconfirmed input");
            Equal((await delivery.Recover("restart notice", "different-message")).Error.Code, "conflict", "recovery must resolve the original pending input first");
        }
        using (var stop = new CancellationTokenSource())
        {
            var native = Ports(file, stop, (_, restored) => { Equal(restored, true, "native recovery recognizes the persisted pending message"); return ValueTask.FromResult(Result<NativeReceipt>.Success(NativeReceipt.Received)); }, _ => published++);
            await using var delivery = NativeDelivery<ProbeInput>.Open(native, Codec, file, 100).Value;
            Equal((await delivery.Settle()).Value, true, "restart can settle the exact pending message without replacing it");
            Equal(published, 1, "recovery reads native evidence without republishing the message");
            Equal((await delivery.Deliver("room message with source attribution", "message-one")).IsSuccess, true, "confirmed duplicate is idempotent");
            Equal(published, 1, "confirmed duplicate does not create another model turn");
            Equal((await delivery.Recover("different content", "message-one")).Error.Code, "conflict", "same message identity cannot change content");
            Equal(delivery.Acknowledge(["message-one"]).IsSuccess, true, "receipt is discarded only after caller acknowledges durable progress");
            Equal(delivery.Unsettled, false, "acknowledged native input no longer occupies the receipt journal");
        }
        Equal(NativeJournal<ProbeInput>.Read(file, "different-native-session", Codec).IsSuccess, false, "native evidence cannot be adopted by a different history");
    }
    private static async Task Deadline(string directory)
    {
        var file = Path.Combine(directory, "deadline.json"); var clock = new ManualTime(); using var stop = new CancellationTokenSource();
        var native = Ports(file, stop, (_, _) => ValueTask.FromResult(Result<NativeReceipt>.Success(NativeReceipt.Pending)), wait: (interval, cancellation) => { cancellation.ThrowIfCancellationRequested(); clock.Advance(TimeSpan.FromMilliseconds(interval)); return ValueTask.CompletedTask; });
        await using var delivery = NativeDelivery<ProbeInput>.Open(native, Codec, file, 100, 1000, clock).Value;
        var result = await delivery.Deliver("not yet confirmed", "deadline-message");
        Equal(result.IsSuccess, false, "native confirmation has a finite inactivity deadline"); Equal(clock.GetTimestamp(), TimeSpan.FromSeconds(1).Ticks, "receipt deadline uses controlled monotonic time");
        Equal(NativeJournal<ProbeInput>.Read(file, "same-native-session", Codec).Value.Pending!.Text, "not yet confirmed", "deadline never drops original message evidence");
    }
    private static async Task ConcurrentAndCancellation(string directory)
    {
        var file = Path.Combine(directory, "cancelled.json"); using var stop = new CancellationTokenSource(); using var caller = new CancellationTokenSource();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously); var confirmation = new TaskCompletionSource<NativeReceipt>(TaskCreationOptions.RunContinuationsAsynchronously);
        var native = Ports(file, stop, async (_, _) => { entered.TrySetResult(); return Result<NativeReceipt>.Success(await confirmation.Task.WaitAsync(caller.Token)); });
        await using var delivery = NativeDelivery<ProbeInput>.Open(native, Codec, file, 100).Value;
        var waiting = delivery.Deliver("original", "cancelled-message", caller.Token).AsTask(); await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Equal((await delivery.Deliver("other", "other-message")).Error.Code, "conflict", "only one native publication/confirmation operation owns the journal");
        await caller.CancelAsync(); Equal((await waiting.WaitAsync(TimeSpan.FromSeconds(5))).IsSuccess, false, "caller cancellation does not claim a native response");
        Equal(delivery.Unsettled, true, "cancelling the waiter keeps original native evidence");
        Equal(NativeJournal<ProbeInput>.Read(file, "same-native-session", Codec).Value.Pending!.MessageId, "cancelled-message", "cancelled wait cannot consume the read position");
    }
    private static void Journal(string directory)
    {
        var file = Path.Combine(directory, "journal.json"); using var journal = NativeJournal<ProbeInput>.Open(file, "same-native-session", Codec).Value;
        Equal(NativeJournal<ProbeInput>.Open(file, "same-native-session", Codec).IsSuccess, false, "duplicate in-process journal owner is refused");
        Equal(journal.Prepare(new("body", "message")).IsSuccess, true, "native pending message saved");
        Equal(journal.Prepare(new("different", "another")).IsSuccess, false, "native journal cannot replace pending identity");
        Equal(journal.Complete(new("different", "message"), true).IsSuccess, false, "native confirmation cannot change content");
        Equal(journal.Complete(new("body", "message"), true).IsSuccess, true, "exact native confirmation creates a digest-bound receipt");
        Equal(journal.Confirmed("body", "message").Value, true, "confirmed text digest is retained");
        Equal(journal.Confirmed("changed", "message").IsSuccess, false, "receipt identity is content-bound");
        Equal(journal.Acknowledge(["message"]).IsSuccess, true, "native acknowledgement is durable");
        Equal(journal.Prepare(new(new string('x', NativeJournal<ProbeInput>.MaximumInputBytes + 1), "too-large")).IsSuccess, false, "native input resource bound is enforced before storage");
        var saved = file + ".saved"; File.Move(file, saved); File.CreateSymbolicLink(file, saved);
        Equal(journal.Prepare(new("must not follow link", "unsafe")).IsSuccess, false, "journal writer refuses a substituted symlink");
        Equal(journal.Pending is null, true, "failed write cannot claim an in-memory pending commit");
        Equal(NativeJournal<ProbeInput>.Read(saved, "same-native-session", Codec).Value.Pending is null, true, "failed write preserves original file contents");
    }
}
