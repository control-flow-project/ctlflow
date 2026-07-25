using System.Data.Common;
using System.Diagnostics;
using System.Text.Json;
using CtlFlow.Tenancy.Tenantd.Db;
using CtlFlow.Tenancy.Tenantd.Db.Schema;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;
using CtlFlow.Tenancy.Tenantd.Service.Configuration;
using CtlFlow.Tenancy.Tenantd.Service.Telemetry;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Schema.Schemas;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures.AggregationFailures;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Security.AggregationAuthentication;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization.AggregationJson;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation;

internal static partial class AggregationHosting
{
    internal static void UseAggregationBoundary(
        WebApplication application,
        ServiceSettings settings)
    {
        application.UseRouting();
        application.Use(async (context, next) =>
        {
            var localPort = context.Connection.LocalPort;
            var isProbe = localPort == settings.ProbePort;
            var isAggregation = localPort == settings.Aggregation.Port;
            var path = context.Request.Path;
            var requestPath = path.Value;
            var isProbePath = requestPath is "/healthz" or "/readyz";
            var isAggregationPath = path.StartsWithSegments(
                TenancyAggregationApi.BasePath);

            if ((isProbe && !isProbePath)
                || (!isProbe && isProbePath)
                || (isAggregation && !isAggregationPath)
                || (!isAggregation && isAggregationPath))
            {
                context.Response.StatusCode =
                    StatusCodes.Status404NotFound;
                return;
            }

            if (!isAggregation)
            {
                await next(context);
                return;
            }

            ApplyAggregationBodyLimit(context);
            await HandleAggregationRequest(
                context,
                next,
                application.Services.GetRequiredService<TenantdTelemetry>(),
                application.Services.GetRequiredService<TenancyJsonContext>());
        });
    }

    private static void ApplyAggregationBodyLimit(HttpContext context)
    {
        var feature = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (feature is not null && !feature.IsReadOnly)
        {
            feature.MaxRequestBodySize =
                TenancyAggregationApi.MaximumRequestBodyBytes;
        }
    }

    private static async Task HandleAggregationRequest(
        HttpContext context,
        RequestDelegate next,
        TenantdTelemetry telemetry,
        TenancyJsonContext json)
    {
        var operation = context.GetEndpoint()?.DisplayName
            ?? "UnknownAggregationOperation";
        using var activity = telemetry.StartHttpOperation(
            operation,
            context.Request.Method,
            context.Request.Headers);
        var started = Stopwatch.GetTimestamp();
        var outcome = "internal_error";

        try
        {
            var actor = await AuthenticateOperator(
                context,
                context.RequestAborted);
            context.Features.Set(new AggregationRequestIdentity(actor));

            if (context.Request.Path
                != TenancyAggregationApi.BasePath
                && await VerifyMigrationLedger(
                    context.RequestServices.GetRequiredService<
                        IDbContextFactory<TenantDbContext>>(),
                    context.RequestAborted)
                    != SchemaCompatibility.Compatible)
            {
                throw CreateAggregationFailure(
                    StatusCodes.Status503ServiceUnavailable,
                    "ServiceUnavailable",
                    "Tenant persistence is unavailable");
            }

            await next(context);
            outcome = context.Response.StatusCode is >= 200 and < 300
                ? "ok"
                : $"http_{context.Response.StatusCode}";
        }
        catch (AggregationFailureException exception)
        {
            outcome = exception.Status.Reason;
            await WriteKubernetesStatus(
                context.Response,
                exception.Status,
                json,
                context.RequestAborted);
        }
        catch (InvalidFieldException exception)
        {
            outcome = "Invalid";
            await WriteKubernetesStatus(
                context.Response,
                CreateAggregationFailure(
                    exception.StatusCode,
                    "Invalid",
                    "The request contains an invalid field",
                    causes:
                    [
                        new KubernetesStatusCauseDocument
                        {
                            Reason = exception.Reason,
                            Message = exception.Message,
                            Field = exception.Field
                        }
                    ]).Status,
                json,
                context.RequestAborted);
        }
        catch (BadHttpRequestException exception) when (
            exception.StatusCode
                == StatusCodes.Status413PayloadTooLarge)
        {
            outcome = "Invalid";
            await WriteKubernetesStatus(
                context.Response,
                CreateAggregationFailure(
                    StatusCodes.Status413PayloadTooLarge,
                    "Invalid",
                    "Request body exceeds the admitted size").Status,
                json,
                context.RequestAborted);
        }
        catch (Exception) when (context.RequestAborted.IsCancellationRequested)
        {
            outcome = "cancelled";
        }
        catch (Exception exception) when (
            exception is JsonException
                or ArgumentException
                or OverflowException)
        {
            outcome = "Invalid";
            await WriteKubernetesStatus(
                context.Response,
                CreateAggregationFailure(
                    StatusCodes.Status400BadRequest,
                    "Invalid",
                    "The request document is invalid").Status,
                json,
                context.RequestAborted);
        }
        catch (Exception exception) when (
            exception is DbException
                or DbUpdateException
                or InvalidOperationException)
        {
            outcome = "ServiceUnavailable";
            await WriteKubernetesStatus(
                context.Response,
                CreateAggregationFailure(
                    StatusCodes.Status503ServiceUnavailable,
                    "ServiceUnavailable",
                    "Tenant persistence is unavailable").Status,
                json,
                context.RequestAborted);
        }
        catch (Exception)
        {
            outcome = "InternalError";
            await WriteKubernetesStatus(
                context.Response,
                CreateAggregationFailure(
                    StatusCodes.Status500InternalServerError,
                    "InternalError",
                    "The request could not be completed").Status,
                json,
                context.RequestAborted);
        }
        finally
        {
            telemetry.RecordHttpOperation(
                activity,
                operation,
                outcome,
                started);
        }
    }
}
