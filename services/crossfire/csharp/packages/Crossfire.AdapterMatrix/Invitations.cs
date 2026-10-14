using System.Collections.Concurrent;
using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public sealed partial class AccountAuthority
{
    private readonly ConcurrentDictionary<string, InvitationState> invitations = new(StringComparer.Ordinal);

    public ValueTask<Result<RoomInvitation?>> Invitation(string matrixId, string roomId, CancellationToken cancellation = default)
        => Exclusive("invitations:" + matrixId, async linked =>
        {
            var account = await AsUser(matrixId, linked);
            if (!account.IsSuccess) return Result<RoomInvitation?>.Fail(account.Error);
            if (!invitations.TryGetValue(matrixId, out var previous))
            {
                var initial = await SynchronizeInvitations(account.Value, matrixId, null, linked);
                if (!initial.IsSuccess) return Result<RoomInvitation?>.Fail(initial.Error);
                previous = initial.Value; invitations[matrixId] = previous;
            }
            var incremental = await SynchronizeInvitations(account.Value, matrixId, previous, linked);
            if (!incremental.IsSuccess) return Result<RoomInvitation?>.Fail(incremental.Error);
            invitations[matrixId] = incremental.Value;
            if (!incremental.Value.Senders.TryGetValue(roomId, out var sender)) return Result<RoomInvitation?>.Success(null);
            if (!Local(sender)) return Results.Fail<RoomInvitation?>("forbidden", "The native inviter must be a local Crossfire identity");
            return await InvitationEvent(sender, matrixId, roomId, linked);
        }, cancellation);

    private async ValueTask<Result<InvitationState>> SynchronizeInvitations(AdapterHttp.NativeEndpoint account, string matrixId, InvitationState? previous, CancellationToken cancellation)
    {
        var result = await MatrixJson.Ok(client, account, "GET", MatrixJson.Api + "/sync?timeout=0&filter=" + MatrixJson.Segment(InvitationSynchronization.Filter)
            + (previous is null ? "" : "&since=" + MatrixJson.Segment(previous.Since)), cancellation: cancellation);
        if (!result.IsSuccess) return Result<InvitationState>.Fail(result.Error);
        return InvitationSynchronization.Apply(result.Value, matrixId, previous);
    }
}
