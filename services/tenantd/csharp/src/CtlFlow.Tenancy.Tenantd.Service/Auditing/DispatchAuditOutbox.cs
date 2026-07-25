using System.Data.Common;
using CtlFlow.Audit.V1;
using CtlFlow.Tenancy.Tenantd.Db;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Service.Configuration;
using CtlFlow.Tenancy.Tenantd.Service.Telemetry;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.AuditOutbox.AuditOutboxEntries;

namespace CtlFlow.Tenancy.Tenantd.Service.Auditing;

internal static partial class AuditDelivery
{
    internal static async Task DispatchAuditOutbox(
        IDbContextFactory<TenantDbContext> databaseContexts,
        AuditService.AuditServiceClient client,
        AuditSettings settings,
        TenantdTelemetry telemetry,
        CancellationToken cancellation)
    {
        while (!cancellation.IsCancellationRequested)
        {
            try
            {
                var now = DateTimeOffset.UtcNow;
                var claim = await ClaimAuditOutboxBatch(
                    databaseContexts,
                    settings.BatchSize,
                    UtcInstant.FromClock(now),
                    UtcInstant.FromClock(now.Add(settings.LeaseDuration)),
                    cancellation);
                if (claim is ClaimAuditOutboxResult.Empty)
                {
                    await Task.Delay(settings.IdleDelay, cancellation);
                    continue;
                }

                var lease = ((ClaimAuditOutboxResult.Claimed)claim).Lease;
                var result = await DeliverAuditOutboxBatch(
                    client,
                    settings,
                    telemetry,
                    lease,
                    cancellation);
                switch (result)
                {
                    case AuditDeliveryResult.Accepted:
                        await CompleteAuditOutboxBatch(
                            databaseContexts,
                            lease,
                            cancellation);
                        break;
                    case AuditDeliveryResult.PermanentFailure permanent:
                        await BlockAuditOutboxBatch(
                            databaseContexts,
                            lease.LeaseId,
                            permanent.FailureCode,
                            cancellation);
                        break;
                    case AuditDeliveryResult.TransientFailure:
                        var delay = CalculateAuditRetryDelay(lease, settings);
                        await ReleaseAuditOutboxBatch(
                            databaseContexts,
                            lease.LeaseId,
                            UtcInstant.FromClock(
                                DateTimeOffset.UtcNow.Add(delay)),
                            cancellation);
                        await Task.Delay(delay, cancellation);
                        break;
                }
            }
            catch (OperationCanceledException) when (
                cancellation.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception) when (
                exception is DbException
                    or DbUpdateException
                    or InvalidOperationException)
            {
                await Task.Delay(settings.RetryBaseDelay, cancellation);
            }
        }
    }
}
