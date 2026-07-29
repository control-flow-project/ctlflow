namespace CtlFlow.Edge.Edged.Service.Http;

internal static partial class PublicBoundary
{
    internal static Task HandleProbeRequest(HttpContext context)
    {
        if (HttpMethods.IsGet(context.Request.Method)
            && (context.Request.Path == "/healthz"
                || context.Request.Path == "/readyz"))
        {
            context.Response.StatusCode = StatusCodes.Status204NoContent;
        }
        else
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
        }

        return Task.CompletedTask;
    }
}
