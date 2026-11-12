using System.Security.Cryptography;
using System.Text;

namespace Fleetd.Storage;

public static class VmBudgetFiles
{
    public static string ForFleet(string fleet)
    {
        if (!Fleetd.Contracts.FleetConfigurationContract.Absolute(fleet)) throw new IOException("VM budget requires an exact fleet directory");
        return Path.Combine(Authentication.Root, "ctlflow", "vm-budgets", Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(fleet))));
    }
}
