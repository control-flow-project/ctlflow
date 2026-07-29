using System.Text;

namespace CtlFlow.Egress.Egressd.Service.Proxy;

internal static partial class EgressProxy
{
    internal static int CalculateHeaderBytes(IHeaderDictionary headers)
    {
        var bytes = 0;
        foreach (var (name, values) in headers)
        {
            foreach (var value in values)
            {
                bytes = checked(
                    bytes
                    + Encoding.UTF8.GetByteCount(name)
                    + Encoding.UTF8.GetByteCount(value ?? "")
                    + 4);
            }
        }

        return bytes;
    }
}
