using Crossfire.AdapterMatrix;
using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class ReconciliationAcceptance
{
    public static async Task Verify(CrossfireDbContext context, Actor owner, long time)
    {
        var now = time;
        var fixture = FleetFixture.Create(context, owner, now);
        const string roomId = "!native-enforcement:example.test";
        var ownerMatrixId = ((NativeAuthentication)owner.Authentication!).MatrixUserId;
        var agentMatrixId = ((NativeAuthentication)fixture.Actor.Authentication!).MatrixUserId;
        var state = new RoomMembership(agentMatrixId, "Native agent", "leave", false, 0);
        var sets = 0; var leaves = 0; var denyAuthority = false; var changeDuringNative = false; var rejectJoined = false;
        NativeRoomAdmission? admission = null;
        using var authority = new AccountAuthority(new("https://unused.example.test", "example.test", "unused-key", "unused-registration", ownerMatrixId));
        void OutsideTransaction() => Equal(context.Database.CurrentTransaction is null, true, "native reconciliation is outside transaction");
        var matrix = authority.Ports() with
        {
            Room = (identity, room, cancellation) =>
            {
                OutsideTransaction();
                return ValueTask.FromResult(denyAuthority ? Results.Fail<RoomFacts>("forbidden", "Native authority lost")
                    : Result<RoomFacts>.Success(new(room, "Native room", "", null, identity, false, 50, [], -1, 0, 0, 50, 50, [])));
            },
            Joined = (identity, cancellation) =>
            {
                OutsideTransaction();
                return ValueTask.FromResult(rejectJoined ? Results.Fail<IReadOnlyList<string>>("native", "Native account unavailable")
                    : Result<IReadOnlyList<string>>.Success(state.Membership == "join" ? [roomId] : []));
            },
            Membership = (identity, target, room, cancellation) =>
            {
                OutsideTransaction(); return ValueTask.FromResult(Result<RoomMembership>.Success(state));
            },
            Invitation = (identity, room, cancellation) => ValueTask.FromResult(Result<RoomInvitation?>.Success(null)),
            Leave = (identity, room, cancellation) =>
            {
                OutsideTransaction(); leaves++; state = state with { Membership = "leave" }; return ValueTask.FromResult(Results.Done());
            },
            SetRoomAccess = (identity, target, room, access, command, cancellation) =>
            {
                OutsideTransaction(); sets++; admission = command;
                state = state with { Membership = "join", PowerLevel = access.PowerLevel };
                if (changeDuringNative)
                {
                    var current = AuthorizationQueries.Principal(context, fixture.AgentId).Value!;
                    Equal(Transactions.Run(context, () => RoomGrantCommands.Revise(context, fixture.AgentId, current.Revision + 1)).IsSuccess,
                        true, "independent authority edit during native command");
                }
                return ValueTask.FromResult(Result<RoomMembership>.Success(state));
            }
        };
        var grants = RoomGrantCommands.Ports(context, () => now, matrix.Room);
        var ports = new RoomReconcilePorts(grants, matrix, () => PolicyQueries.Find(context),
            id => AuthorizationQueries.AgentView(context, id).Map(value => value?.Application), authority.RoomOperation);
        var first = await RoomGrantChanges.Change(grants, owner, new(fixture.AgentId, roomId, 0, null, "reply", null, false), Identity.Identifier());
        Equal(first.IsSuccess, true, "desired room membership prepared");
        Equal((await RoomReconciliation.Reconcile(ports, fixture.AgentId, roomId)).IsSuccess, true, "first native grant enforcement");
        Equal(sets, 1, "one native admission command");
        Equal(admission?.Kind, "managed", "first enforcement carries admission authority");
        var applied = RoomGrantQueries.Application(context, fixture.AgentId, roomId).Value!;
        Equal(applied.ObservedGeneration, first.Value.Grant!.Generation, "native enforcement bound to exact membership generation");
        Equal(applied.AppliedAccessRevision, 0L, "native access revision acknowledged");
        Equal(applied.Membership, "join", "observed membership persisted");
        Equal(applied.ErrorCode is null, true, "successful enforcement clears previous errors");
        state = state with { Membership = "leave" }; now++;
        Equal((await RoomReconciliation.Reconcile(ports, fixture.AgentId, roomId)).IsSuccess, true, "departed native membership observed");
        Equal(sets, 1, "unchanged grant cannot auto-readmit participant");
        Equal(RoomGrantQueries.Application(context, fixture.AgentId, roomId).Value?.Membership, "leave", "manual departure remains visible");
        var read = await RoomGrantChanges.Change(grants, owner, new(fixture.AgentId, roomId, 1, first.Value.Grant.Generation, "read", null, false), Identity.Identifier());
        Equal(read.IsSuccess, true, "explicit access change creates new enforceable intent");
        Equal((await RoomReconciliation.Reconcile(ports, fixture.AgentId, roomId)).IsSuccess, true, "explicit read-only grant enforced");
        Equal(state.PowerLevel, -1L, "read level derived from native permission thresholds");
        Equal(sets, 2, "explicit revision authorizes another native command");
        var lastSuccess = RoomGrantQueries.Application(context, fixture.AgentId, roomId).Value!.LastSuccessAt;
        denyAuthority = true; now++;
        Equal((await RoomReconciliation.Reconcile(ports, fixture.AgentId, roomId)).IsSuccess, true, "native failure recorded for later retry");
        Equal(leaves, 1, "lost authorizer removes native access");
        var failed = RoomGrantQueries.Application(context, fixture.AgentId, roomId).Value!;
        Equal(failed.ErrorCode, "forbidden", "original native failure retained");
        Equal(failed.ErrorMessage, "Native authority lost", "native failure cause is not replaced by a recovery label");
        Equal(failed.LastSuccessAt, lastSuccess, "failed enforcement preserves prior success evidence");
        Equal(failed.NextCheckAt, now + PolicyQueries.Find(context).Value!.ReconcileSeconds * 1000, "bounded retry scheduled without model polling");
        denyAuthority = false;
        var restore = await RoomGrantChanges.Change(grants, owner, new(fixture.AgentId, roomId, 2, first.Value.Grant.Generation, "reply", null, false), Identity.Identifier());
        Equal(restore.IsSuccess, true, "explicit reply restoration");
        changeDuringNative = true;
        Equal((await RoomReconciliation.Reconcile(ports, fixture.AgentId, roomId)).Error.Code, "conflict", "changed authority cannot acknowledge stale native application");
        Equal(RoomGrantQueries.Application(context, fixture.AgentId, roomId).Value?.AppliedAccessRevision, 1L, "stale native command cannot claim new access revision applied");
        changeDuringNative = false;
        Equal((await RoomReconciliation.Reconcile(ports, fixture.AgentId, roomId)).IsSuccess, true, "current intent can recover after authority race");
        Equal(RoomGrantQueries.Application(context, fixture.AgentId, roomId).Value?.ErrorCode is null, true, "successful recovery clears old failure");
        Equal(Transactions.Run(context, () =>
        {
            var id = fixture.AgentId;
            context.Principal.Single(row => row.Id == id).Status = "revoked";
            context.PrincipalApplication.Single(row => row.PrincipalId == id).AppliedStatus = "revoked";
            return Results.Done();
        }).IsSuccess, true, "verified native revocation fixture");
        rejectJoined = true;
        Equal((await RoomReconciliation.Reconcile(ports, fixture.AgentId, roomId)).IsSuccess, true, "verified deactivated account does not require new native login");
        Equal(RoomGrantQueries.Application(context, fixture.AgentId, roomId).Value?.Membership, "leave", "revocation records absence with existing account proof");
    }
}
