using System.Text.Json;
using Crossfire.AdapterHttp;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public sealed partial class AccountAuthority
{
    public async ValueTask<Result<RoomInvitation?>> InvitationEvent(string authorizer, string target, string roomId, CancellationToken cancellation = default)
    {
        var state = await State(authorizer, roomId, cancellation);
        if (!state.IsSuccess) return Result<RoomInvitation?>.Fail(state.Error);
        if (state.Value.Count > 1000) return Results.Fail<RoomInvitation?>("native", "Native invitation could not be verified");
        var member = state.Value.FirstOrDefault(value => value.Type == "m.room.member" && value.StateKey == target);
        if (member is null || RoomState.String(member.Content, "membership") != "invite" || member.Sender != authorizer)
            return Result<RoomInvitation?>.Success(null);
        if (member.EventId is null || !Validation.EventId(member.EventId)) return Results.Fail<RoomInvitation?>("native", "Invalid native invitation identity");
        var direct = member.Content.TryGetProperty("is_direct", out var directValue);
        if (direct && directValue.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return Results.Fail<RoomInvitation?>("native", "Invalid native direct invitation");
        return Result<RoomInvitation?>.Success(new(roomId, authorizer, member.EventId, direct && directValue.ValueKind == JsonValueKind.True));
    }

    public async ValueTask<Result<RoomMembership>> SetRoomAccess(string authorizer, string target, string roomId,
        NativeRoomAccess access, NativeRoomAdmission? admission, CancellationToken cancellation = default)
    {
        var facts = await Room(authorizer, roomId, cancellation);
        if (!facts.IsSuccess) return Result<RoomMembership>.Fail(facts.Error);
        var powerLevel = access.PowerLevel;
        if (powerLevel > Validation.MaxWireInteger || powerLevel < -Validation.MaxWireInteger || !facts.Value.Creator && powerLevel > facts.Value.PowerLevel)
            return Results.Fail<RoomMembership>("forbidden", "Requested power exceeds native authority");
        if (facts.Value.CreatorIds.Contains(target, StringComparer.Ordinal) && access.Mode != "reply")
            return Results.Fail<RoomMembership>("forbidden", "Native creator authority cannot be restricted by an agent grant");
        if (!facts.Value.CreatorIds.Contains(target, StringComparer.Ordinal) && access.Mode == "reply" && powerLevel < facts.Value.ReplyLevel)
            return Results.Fail<RoomMembership>("forbidden", "Read-and-reply access requires native reply authority");
        var current = await Membership(authorizer, target, roomId, cancellation);
        if (!current.IsSuccess) return current;
        if (admission is null && current.Value.Membership != "join") return current;
        var account = await AsUser(authorizer, cancellation);
        if (!account.IsSuccess) return Result<RoomMembership>.Fail(account.Error);
        var path = MatrixJson.Api + "/rooms/" + MatrixJson.Segment(roomId);
        async ValueTask<Result<Unit>> VerifyInvitation()
        {
            if (admission?.Kind != "invitation" || current.Value.Membership == "join") return Results.Done();
            if (admission.SenderMatrixId != authorizer) return Results.Fail<Unit>("forbidden", "Native invitation authority does not match");
            var invitation = await InvitationEvent(authorizer, target, roomId, cancellation);
            if (!invitation.IsSuccess) return Result<Unit>.Fail(invitation.Error);
            return invitation.Value?.EventId == admission.EventId ? Results.Done() : Results.Fail<Unit>("conflict", "Native invitation was withdrawn or replaced");
        }
        var verified = await VerifyInvitation();
        if (!verified.IsSuccess) return Result<RoomMembership>.Fail(verified.Error);
        if (!current.Value.Creator && current.Value.PowerLevel != powerLevel)
        {
            var powers = await MatrixJson.Ok(client, account.Value, "GET", path + "/state/m.room.power_levels", cancellation: cancellation);
            if (!powers.IsSuccess) return Result<RoomMembership>.Fail(powers.Error);
            var users = powers.Value.TryGetProperty("users", out var userValues) ? userValues : default;
            if (users.ValueKind is not (JsonValueKind.Object or JsonValueKind.Undefined)) return Results.Fail<RoomMembership>("native", "Invalid native power levels");
            var content = MatrixJson.Object(writer =>
            {
                foreach (var property in powers.Value.EnumerateObject()) if (property.Name != "users") property.WriteTo(writer);
                writer.WriteStartObject("users");
                if (users.ValueKind == JsonValueKind.Object) foreach (var property in users.EnumerateObject()) if (property.Name != target) property.WriteTo(writer);
                writer.WriteNumber(target, powerLevel); writer.WriteEndObject();
            });
            var changed = await MatrixJson.Ok(client, account.Value, "PUT", path + "/state/m.room.power_levels", content, cancellation);
            if (!changed.IsSuccess) return Result<RoomMembership>.Fail(changed.Error);
        }
        if (current.Value.Membership != "join")
        {
            var invited = admission?.Kind == "managed"
                ? (await MatrixJson.Ok(client, account.Value, "POST", path + "/invite", MatrixJson.Object(writer => writer.WriteString("user_id", target)), cancellation)).Map(_ => default(Unit))
                : await VerifyInvitation();
            if (!invited.IsSuccess) return Result<RoomMembership>.Fail(invited.Error);
            var targetAccount = await AsUser(target, cancellation);
            if (!targetAccount.IsSuccess) return Result<RoomMembership>.Fail(targetAccount.Error);
            var accepted = await MatrixJson.Ok(client, targetAccount.Value, "POST", path + "/join", MatrixJson.Object(_ => { }), cancellation);
            if (!accepted.IsSuccess) return Result<RoomMembership>.Fail(accepted.Error);
        }
        var checkedMember = await MembershipState(authorizer, target, roomId, cancellation);
        if (!checkedMember.IsSuccess) return Result<RoomMembership>.Fail(checkedMember.Error);
        var member = checkedMember.Value.Member;
        if (member.Membership != "join" || (member.Creator ? access.Mode != "reply" : member.PowerLevel != powerLevel
            || access.Mode == "reply" && member.PowerLevel < checkedMember.Value.ReplyLevel
            || access.Mode == "read" && member.PowerLevel > checkedMember.Value.ReadLevel))
            return Results.Fail<RoomMembership>("native", "Native room membership and requested permissions were not confirmed");
        return Result<RoomMembership>.Success(member);
    }
}
