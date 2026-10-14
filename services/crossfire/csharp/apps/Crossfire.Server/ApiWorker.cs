using System.Threading.Channels;
using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using Crossfire.Server.Http;

namespace Crossfire.Server;

public sealed class ApiWorker(ApiState state, TimeProvider? time = null) : IAsyncDisposable
{
    private readonly Channel<bool> wake = Channel.CreateBounded<bool>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true });
    private readonly CancellationTokenSource stop = new();
    private readonly TimeProvider clock = time ?? TimeProvider.System;
    private Task? running;

    public void Start()
    {
        if (running is not null) throw new InvalidOperationException("The application worker is already started");
        Wake(); running = Task.WhenAll(Run(), Maintain());
    }

    public void Wake() => wake.Writer.TryWrite(true);

    private async Task Run()
    {
        while (!stop.IsCancellationRequested)
        {
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5), clock);
            using var wait = CancellationTokenSource.CreateLinkedTokenSource(stop.Token, deadline.Token);
            try { await wake.Reader.ReadAsync(wait.Token); }
            catch (OperationCanceledException) when (!stop.IsCancellationRequested) { }
            catch (OperationCanceledException) { break; }
            if (stop.IsCancellationRequested) break;
            try
            {
                using var context = new CrossfireDbContext(state.Database);
                var enrolled = EnrollmentCommands.Ports(context, state.Now, state.Configuration.ServerName, state.Matrix.Identify, state.Matrix.Room);
                var expired = Transactions.Run(context, () => EnrollmentRequests.Expire(enrolled));
                if (!expired.IsSuccess) { state.Diagnostics.Write("Enrollment maintenance remains pending: " + expired.Error.Code); continue; }
                var decisions = Decisions.Expire(DecisionCommands.Ports(context, state.Now));
                if (!decisions.IsSuccess) { state.Diagnostics.Write("Native decision maintenance remains pending: " + decisions.Error.Code); continue; }
                var watched = RuntimeContact.Observe(ContactQueries.Ports(context, state.Now, state.Matrix.Ports(), state.Configuration.PublicOrigin, state.Configuration.ServiceMatrixId));
                if (!watched.IsSuccess) state.Diagnostics.Write("Runtime contact observation remains pending: " + watched.Error.Code);
                var result = await Apply(context, stop.Token);
                if (!result.IsSuccess) state.Diagnostics.Write("Crossfire reconciliation remains pending: " + result.Error.Code);
                var reports = await Publications.Maintain(PublicationRoutes.Ports(state, context));
                if (!reports.IsSuccess) state.Diagnostics.Write("Public report cleanup remains pending: " + reports.Error.Code);
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
            catch (Exception exception) { state.Diagnostics.Write("Crossfire reconciliation failed: " + exception.GetType().Name + "; native state remains unverified"); }
        }
    }

    private async Task Maintain()
    {
        var progress = new LoggingProgress(long.MinValue, new());
        while (!stop.IsCancellationRequested)
        {
            try { progress = LoggingMaintenance.Run(state, progress); }
            catch (Exception error)
            {
                state.Diagnostics.MaintenanceError("Platform logging maintenance remains pending: " + error.GetType().Name);
                progress = progress with { NextAt = state.Now() + 5000 };
            }
            try { await Task.Delay(TimeSpan.FromMilliseconds(Math.Max(1, progress.NextAt - state.Now())), clock, stop.Token); }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
        }
    }

    private async ValueTask<Result<Unit>> Apply(CrossfireDbContext context, CancellationToken cancellation)
    {
        var claims = await MemberRegistration.CleanClaims(RegistrationQueries.Ports(context, state.Now, state.Matrix.Ports(), state.Matrix.RoomOperation,
            state.Configuration.ServerName, state.Configuration.ServiceMatrixId), cancellation);
        if (!claims.IsSuccess) return claims;
        var due = PrincipalApplicationCommands.Due(context, state.Now(), 100);
        if (!due.IsSuccess) return Result<Unit>.Fail(due.Error);
        var native = PrincipalApplicationCommands.Ports(context, state.Now, state.Matrix.Ports(), state.Matrix.RoomOperation);
        foreach (var id in due.Value)
        {
            cancellation.ThrowIfCancellationRequested();
            var applied = await PrincipalApplications.Reconcile(native, id, cancellation);
            if (!applied.IsSuccess && applied.Error.Code != "conflict") return applied;
        }
        var grants = RoomGrantQueries.Due(context, state.Now(), 100);
        if (!grants.IsSuccess) return Result<Unit>.Fail(grants.Error);
        var rooms = OwnerConversationCommands.Ports(context, state.Now, state.Matrix.Ports(), state.Matrix.RoomOperation).Reconciliation;
        foreach (var grant in grants.Value)
        {
            cancellation.ThrowIfCancellationRequested();
            var applied = await RoomReconciliation.Reconcile(rooms, grant.AgentId, grant.RoomId, cancellation);
            if (!applied.IsSuccess && applied.Error.Code != "conflict") return applied;
        }
        var notices = WakeNoticeQueries.Ports(context, state.Now, state.Matrix.Ports()); var pendingNotices = notices.Due(state.Now());
        if (!pendingNotices.IsSuccess) return Result<Unit>.Fail(pendingNotices.Error);
        foreach (var notice in pendingNotices.Value)
        {
            cancellation.ThrowIfCancellationRequested();
            var published = await WakeNotices.Publish(notices, notice.ReceiverAgentId, notice.EventId, cancellation); if (!published.IsSuccess) return published;
        }
        return await RuntimeIncidents.Deliver(IncidentCommands.Ports(context, state.Now, state.Matrix.Ports(), state.Configuration.PublicOrigin, state.Configuration.ServiceMatrixId), cancellation);
    }

    public async ValueTask DisposeAsync()
    {
        stop.Cancel();
        if (running is not null) await running;
        stop.Dispose();
    }
}
