using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public sealed partial class AccountAuthority
{
    public MatrixPorts Ports() => new(Identify, Exists, Provision, Deactivate, Discard, ProfileName, SetDisplayName, Joined,
        OwnerConversation, VerifyOwnerConversation, MarkDirect, Room, Membership, Invitation, SetRoomAccess, Leave, Event, SendNotice);

    public ValueTask<Result<Unit>> RoomOperation(string roomId, Func<CancellationToken, ValueTask<Result<Unit>>> operation, CancellationToken cancellation = default)
        => Exclusive("room:" + roomId, operation, cancellation);
}
