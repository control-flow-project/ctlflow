using System.Text.Json;
using Crossfire.AdapterHttp;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public sealed partial class AccountAuthority
{
    public async ValueTask<Result<RoomFacts>> Room(string user, string room, string? subject, CancellationToken cancellation = default)
        => (await NativeRoom(user, room, cancellation)).Map(value => AuthorityValues.View(value, subject));
    public async ValueTask<Result<RoomMembership>> Membership(string user, string target, string room, CancellationToken cancellation = default)
        => (await NativeMembership(user, target, room, cancellation)).Map(AuthorityValues.View);
    public async ValueTask<Result<RoomFacts>> AuthorizeRoomAccess(string user, string target, string room, RoomAccessIntent intent, CancellationToken cancellation = default)
    {
        var facts = await NativeRoom(user, room, cancellation); if (!facts.IsSuccess) return Result<RoomFacts>.Fail(facts.Error);
        var requested = AuthorityValues.RequestedPower(facts.Value, target, intent);
        return requested.IsSuccess ? Result<RoomFacts>.Success(AuthorityValues.View(facts.Value, target)) : Result<RoomFacts>.Fail(requested.Error);
    }
    public async ValueTask<Result<RoomMembership>> SetRoomAccess(string user, string target, string room, RoomAccessIntent intent, RoomAdmission? admission, CancellationToken cancellation = default)
    {
        var facts = await NativeRoom(user, room, cancellation); if (!facts.IsSuccess) return Result<RoomMembership>.Fail(facts.Error);
        var requested = AuthorityValues.RequestedPower(facts.Value, target, intent, true); if (!requested.IsSuccess) return Result<RoomMembership>.Fail(requested.Error);
        var member = await NativeMembership(user, target, room, cancellation); if (!member.IsSuccess) return Result<RoomMembership>.Fail(member.Error);
        var level = admission is not null || member.Value.Creator ? requested.Value : Math.Min(requested.Value, member.Value.PowerLevel!.Value);
        return (await SetRoomPower(user, target, room, new(intent.AccessMode, level), admission, cancellation)).Map(AuthorityValues.View);
    }

    public async ValueTask<Result<RoomInvitation?>> InvitationEvent(string authorizer, string target, string roomId, CancellationToken cancellation = default)
    {
        var state = await State(authorizer, roomId, cancellation);
        if (!state.IsSuccess) return Result<RoomInvitation?>.Fail(state.Error);
        if (state.Value.Count > 1000) return Results.Fail<RoomInvitation?>("native", "Native invitation could not be verified");
        var member = state.Value.FirstOrDefault(value => value.Type == "m.room.member" && value.StateKey == target);
        if (member is null || RoomState.String(member.Content, "membership") != "invite" || member.Sender != authorizer)
            return Result<RoomInvitation?>.Success(null);
        if (member.EventId is null || !MatrixSyntax.EventId(member.EventId)) return Results.Fail<RoomInvitation?>("native", "Invalid native invitation identity");
        var direct = member.Content.TryGetProperty("is_direct", out var directValue);
        if (direct && directValue.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return Results.Fail<RoomInvitation?>("native", "Invalid native direct invitation");
        return Result<RoomInvitation?>.Success(new(roomId, authorizer, member.EventId, direct && directValue.ValueKind == JsonValueKind.True));
    }

    private async ValueTask<Result<MatrixMembership>> SetRoomPower(string authorizer, string target, string roomId,
        MatrixAccess access, RoomAdmission? admission, CancellationToken cancellation = default)
    {
        var facts = await NativeRoom(authorizer, roomId, cancellation);
        if (!facts.IsSuccess) return Result<MatrixMembership>.Fail(facts.Error);
        var powerLevel = access.PowerLevel;
        if (powerLevel > Validation.MaxWireInteger || powerLevel < -Validation.MaxWireInteger || !facts.Value.Creator && powerLevel > facts.Value.PowerLevel)
            return Results.Fail<MatrixMembership>("forbidden", "Requested power exceeds native authority");
        if (facts.Value.CreatorIds.Contains(target, StringComparer.Ordinal) && access.Mode != "reply")
            return Results.Fail<MatrixMembership>("forbidden", "Native creator authority cannot be restricted by an agent grant");
        if (!facts.Value.CreatorIds.Contains(target, StringComparer.Ordinal) && access.Mode == "reply" && powerLevel < facts.Value.ReplyLevel)
            return Results.Fail<MatrixMembership>("forbidden", "Read-and-reply access requires native reply authority");
        var current = await NativeMembership(authorizer, target, roomId, cancellation);
        if (!current.IsSuccess) return current;
        if (admission is null && current.Value.Membership != "join") return current;
        var account = await AsUser(authorizer, cancellation);
        if (!account.IsSuccess) return Result<MatrixMembership>.Fail(account.Error);
        var path = MatrixJson.Api + "/rooms/" + MatrixJson.Segment(roomId);
        async ValueTask<Result<Unit>> VerifyInvitation()
        {
            if (admission?.Kind != "invitation" || current.Value.Membership == "join") return Results.Done();
            if (admission.SenderBackendUserId != authorizer) return Results.Fail<Unit>("forbidden", "Native invitation authority does not match");
            var invitation = await InvitationEvent(authorizer, target, roomId, cancellation);
            if (!invitation.IsSuccess) return Result<Unit>.Fail(invitation.Error);
            return invitation.Value?.EventId == admission.EventId ? Results.Done() : Results.Fail<Unit>("conflict", "Native invitation was withdrawn or replaced");
        }
        var verified = await VerifyInvitation();
        if (!verified.IsSuccess) return Result<MatrixMembership>.Fail(verified.Error);
        if (!current.Value.Creator && current.Value.PowerLevel != powerLevel)
        {
            var powers = await MatrixJson.Ok(client, account.Value, "GET", path + "/state/m.room.power_levels", cancellation: cancellation);
            if (!powers.IsSuccess) return Result<MatrixMembership>.Fail(powers.Error);
            var users = powers.Value.TryGetProperty("users", out var userValues) ? userValues : default;
            if (users.ValueKind is not (JsonValueKind.Object or JsonValueKind.Undefined)) return Results.Fail<MatrixMembership>("native", "Invalid native power levels");
            var content = MatrixJson.Object(writer =>
            {
                foreach (var property in powers.Value.EnumerateObject()) if (property.Name != "users") property.WriteTo(writer);
                writer.WriteStartObject("users");
                if (users.ValueKind == JsonValueKind.Object) foreach (var property in users.EnumerateObject()) if (property.Name != target) property.WriteTo(writer);
                writer.WriteNumber(target, powerLevel); writer.WriteEndObject();
            });
            var changed = await MatrixJson.Ok(client, account.Value, "PUT", path + "/state/m.room.power_levels", content, cancellation);
            if (!changed.IsSuccess) return Result<MatrixMembership>.Fail(changed.Error);
        }
        if (current.Value.Membership != "join")
        {
            var invited = admission?.Kind == "managed"
                ? (await MatrixJson.Ok(client, account.Value, "POST", path + "/invite", MatrixJson.Object(writer => writer.WriteString("user_id", target)), cancellation)).Map(_ => default(Unit))
                : await VerifyInvitation();
            if (!invited.IsSuccess) return Result<MatrixMembership>.Fail(invited.Error);
            var targetAccount = await AsUser(target, cancellation);
            if (!targetAccount.IsSuccess) return Result<MatrixMembership>.Fail(targetAccount.Error);
            var accepted = await MatrixJson.Ok(client, targetAccount.Value, "POST", path + "/join", MatrixJson.Object(_ => { }), cancellation);
            if (!accepted.IsSuccess) return Result<MatrixMembership>.Fail(accepted.Error);
        }
        var checkedMember = await MembershipState(authorizer, target, roomId, cancellation);
        if (!checkedMember.IsSuccess) return Result<MatrixMembership>.Fail(checkedMember.Error);
        var member = checkedMember.Value.Member;
        if (member.Membership != "join" || (member.Creator ? access.Mode != "reply" : member.PowerLevel != powerLevel
            || access.Mode == "reply" && member.PowerLevel < checkedMember.Value.ReplyLevel
            || access.Mode == "read" && member.PowerLevel > checkedMember.Value.ReadLevel))
            return Results.Fail<MatrixMembership>("native", "Native room membership and requested permissions were not confirmed");
        return Result<MatrixMembership>.Success(member);
    }
}
