using System.Security.Cryptography;
using System.Text;

namespace Fleetd.Storage;

public static class NativeOwnershipFiles
{
    public static string ForState(string state)
    {
        if (!Fleetd.Contracts.FleetConfigurationContract.Absolute(state) || state.Contains('\0'))
            throw new IOException("Native state requires an exact absolute path");
        var key = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(state)));
        return Path.Combine(Authentication.Root, "ctlflow", "native-ownership", key);
    }
}
