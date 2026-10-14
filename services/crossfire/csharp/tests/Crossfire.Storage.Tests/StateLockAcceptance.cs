using Crossfire.AdapterFilesystem;

namespace Crossfire.Storage.Tests;

public static class StateLockAcceptance
{
    public static async Task<bool> Run(string[] arguments)
    {
        if (arguments.Length == 0 || arguments[0] != "--state-lock") return false;
        if (arguments.Length != 3 || arguments[1] is not ("probe" or "hold")) throw new ArgumentException("Select an explicit ownership check");
        StateLock? owner = null;
        try { owner = new(arguments[2]); }
        catch (IOException error) when (error.Message == "Another process already owns this private state") { Console.WriteLine("{\"owned\":false}"); return true; }
        using (owner)
        {
            Console.WriteLine("{\"owned\":true}");
            if (arguments[1] == "hold") await Console.In.ReadLineAsync();
        }
        return true;
    }
}
