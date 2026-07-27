using CtlFlow.Auth.Authd.Service.Configuration;

namespace CtlFlow.Auth.Authd.Service.Http;

internal static partial class BrowserRequests
{
    internal static void ValidateBrowserPost(
        HttpRequest request,
        ProviderProjection projection)
    {
        var origins = request.Headers.Origin;
        var hosts = request.Headers.Host;
        var expectedOrigin =
            $"{projection.PublicOrigin.Scheme}://{projection.PublicOrigin.Authority}";
        if (origins.Count != 1
            || hosts.Count != 1
            || !string.Equals(
                origins[0],
                expectedOrigin,
                StringComparison.Ordinal)
            || !string.Equals(
                request.Host.Value,
                projection.PublicOrigin.Authority,
                StringComparison.OrdinalIgnoreCase))
        {
            throw new HttpContractException(
                StatusCodes.Status403Forbidden,
                "origin_rejected");
        }
    }
}
