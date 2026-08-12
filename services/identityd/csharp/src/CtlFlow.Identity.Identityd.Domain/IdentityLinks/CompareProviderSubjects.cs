using System.Text;

namespace CtlFlow.Identity.Identityd.Domain.IdentityLinks;

public static partial class ProviderSubjects
{
    public static int CompareProviderSubjects(string left, string right)
    {
        var leftBytes = Encoding.UTF8.GetBytes(left);
        var rightBytes = Encoding.UTF8.GetBytes(right);
        return leftBytes.AsSpan().SequenceCompareTo(rightBytes);
    }
}
