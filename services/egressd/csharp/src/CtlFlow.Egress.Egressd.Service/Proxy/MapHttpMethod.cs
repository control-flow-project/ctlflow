using CtlFlow.Egress.Egressd.Domain.Rules;

namespace CtlFlow.Egress.Egressd.Service.Proxy;

internal static partial class EgressProxy
{
    internal static EgressMethod? MapHttpMethod(string method) =>
        method switch
        {
            "GET" => EgressMethod.Get,
            "HEAD" => EgressMethod.Head,
            "POST" => EgressMethod.Post,
            "PUT" => EgressMethod.Put,
            "PATCH" => EgressMethod.Patch,
            "DELETE" => EgressMethod.Delete,
            "OPTIONS" => EgressMethod.Options,
            _ => null
        };

    internal static string FormatHttpMethod(EgressMethod method) =>
        method switch
        {
            EgressMethod.Get => "GET",
            EgressMethod.Head => "HEAD",
            EgressMethod.Post => "POST",
            EgressMethod.Put => "PUT",
            EgressMethod.Patch => "PATCH",
            EgressMethod.Delete => "DELETE",
            EgressMethod.Options => "OPTIONS",
            _ => throw new InvalidOperationException(
                "Egress method is invalid")
        };
}
