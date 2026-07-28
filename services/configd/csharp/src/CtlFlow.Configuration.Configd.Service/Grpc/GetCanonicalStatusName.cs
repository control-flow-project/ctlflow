using Grpc.Core;

namespace CtlFlow.Configuration.Configd.Service.Grpc;

internal static partial class GrpcStatuses
{
    internal static string GetCanonicalStatusName(StatusCode status)
    {
        var source = status.ToString();
        Span<char> destination = stackalloc char[source.Length * 2];
        var written = 0;
        for (var index = 0; index < source.Length; index++)
        {
            var character = source[index];
            if (index > 0
                && char.IsUpper(character)
                && char.IsLower(source[index - 1]))
            {
                destination[written++] = '_';
            }

            destination[written++] = char.ToUpperInvariant(character);
        }

        return new string(destination[..written]);
    }
}
