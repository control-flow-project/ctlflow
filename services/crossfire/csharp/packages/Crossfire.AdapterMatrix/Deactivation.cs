using Crossfire.AdapterHttp;
using Crossfire.Kernel;

namespace Crossfire.AdapterMatrix;

public sealed partial class AccountAuthority
{
    public ValueTask<Result<Unit>> Deactivate(string id, CancellationToken cancellation = default)
        => Exclusive(id, linked => Remove(id, linked), cancellation);

    public ValueTask<Result<Unit>> Discard(string id, CancellationToken cancellation = default)
        => Exclusive(id, async linked =>
        {
            var exists = await Exists(id, linked);
            return !exists.IsSuccess ? Result<Unit>.Fail(exists.Error) : exists.Value ? await Remove(id, linked) : Results.Done();
        }, cancellation);

    private async ValueTask<Result<bool>> Deactivated(string id, CancellationToken cancellation)
    {
        var body = MatrixJson.Object(writer =>
        {
            writer.WriteString("type", "m.login.password"); writer.WriteStartObject("identifier");
            writer.WriteString("type", "m.id.user"); writer.WriteString("user", id); writer.WriteEndObject();
            writer.WriteString("password", "crossfire-deactivation-probe");
        });
        var result = await NativeHttp.Json(client, Server(), "POST", MatrixJson.Api + "/login", body, cancellation: cancellation);
        if (!result.IsSuccess) return Result<bool>.Fail(result.Error);
        using var response = result.Value;
        if (response.Status == 403 && MatrixJson.Error(response.Body, "M_USER_DEACTIVATED")) return Result<bool>.Success(true);
        if (response.Status == 403 && MatrixJson.Error(response.Body, "M_FORBIDDEN")) return Result<bool>.Success(false);
        if (response.Status == 200)
        {
            var authenticated = Credentials(response.Body, id);
            if (!authenticated.IsSuccess) return Result<bool>.Fail(authenticated.Error);
            var ended = await MatrixJson.Ok(client, Server(authenticated.Value.AccessToken), "POST", MatrixJson.Api + "/logout", MatrixJson.Object(_ => { }), cancellation);
            return ended.IsSuccess ? Result<bool>.Success(false) : Result<bool>.Fail(ended.Error);
        }
        return Results.Fail<bool>("native", "Native account deactivation could not be verified");
    }

    private async ValueTask<Result<Unit>> Remove(string id, CancellationToken cancellation)
    {
        if (!Local(id) || id == configuration.ServiceMatrixId || id == "@conduit:" + configuration.ServerName)
            return Results.Fail<Unit>("forbidden", "Protected or invalid native account");
        var checkedAccount = await Deactivated(id, cancellation);
        if (!checkedAccount.IsSuccess) return Result<Unit>.Fail(checkedAccount.Error);
        if (checkedAccount.Value) return Results.Done();
        var administrator = await AsUser(configuration.ServiceMatrixId, cancellation);
        if (!administrator.IsSuccess) return Result<Unit>.Fail(administrator.Error);
        var room = await MatrixJson.Ok(client, administrator.Value, "GET", MatrixJson.Api + "/directory/room/" + MatrixJson.Segment("#admins:" + configuration.ServerName), cancellation: cancellation);
        if (!room.IsSuccess) return Result<Unit>.Fail(room.Error);
        var roomId = MatrixJson.Text(room.Value, "room_id");
        if (roomId is null) return Results.Fail<Unit>("native", "Native administration room is unavailable");
        var transaction = Crossfire.Kernel.Identity.Hash("deactivate:" + id);
        var body = MatrixJson.Object(writer =>
        {
            writer.WriteString("msgtype", "m.text");
            writer.WriteString("body", "@conduit:" + configuration.ServerName + ": deactivate-user --leave-rooms " + id);
        });
        var sent = await MatrixJson.Ok(client, administrator.Value, "PUT", MatrixJson.Api + "/rooms/" + MatrixJson.Segment(roomId) + "/send/m.room.message/" + transaction, body, cancellation);
        if (!sent.IsSuccess) return Result<Unit>.Fail(sent.Error);
        var started = time.GetTimestamp();
        while (time.GetElapsedTime(started) < TimeSpan.FromSeconds(30))
        {
            var confirmed = await Deactivated(id, cancellation);
            if (!confirmed.IsSuccess) return Result<Unit>.Fail(confirmed.Error);
            if (confirmed.Value) { sessions.TryRemove(id, out _); return Results.Done(); }
            try { await Task.Delay(TimeSpan.FromMilliseconds(200), time, cancellation); }
            catch (OperationCanceledException) { return Results.Fail<Unit>("native", "Native authority stopped before deactivation was confirmed"); }
        }
        return Results.Fail<Unit>("native", "Native account deactivation remains unconfirmed");
    }
}
