using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Crossfire.AdapterProcess;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Contracts;
using Fleetd.Domain;

namespace Fleetd.AdapterExecution.Vm;

public readonly record struct VmMemory(long TotalKiB, long AvailableKiB);

// A fleet slice caps all guests and helpers together. Each execution also has
// its own finite service; guest RAM is not a reservation of host physical memory.
public static class Resources
{
    public const int HelperMiB = 512;
    public const int Tasks = 1024;
    private const long MiB = 1048576;
    private static string Number(long value) => value.ToString(CultureInfo.InvariantCulture);
    public static string Slice(string directory)
    {
        if (!FleetConfigurationContract.Absolute(directory)) throw new ArgumentException("Fleet VM budget requires an exact directory");
        return "ctlflow-vm-" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(directory))) + ".slice";
    }
    public static Result<VmMemory> ParseMemory(string text)
    {
        if (text.Length > 65536) return Results.Fail<VmMemory>("unavailable", "Host memory information exceeds its bound");
        long? total = null, available = null;
        foreach (var line in text.Split('\n'))
        {
            var fields = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
            if (fields.Length == 0 || fields[0] is not ("MemTotal:" or "MemAvailable:")) continue;
            if (fields.Length != 3 || fields[2] != "kB" || !long.TryParse(fields[1], NumberStyles.None, CultureInfo.InvariantCulture, out var value)
                || value < 0 || value > long.MaxValue / 1024 || fields[0] == "MemTotal:" && total is not null || fields[0] == "MemAvailable:" && available is not null)
                return Results.Fail<VmMemory>("unavailable", "Cannot establish host memory availability");
            if (fields[0] == "MemTotal:") total = value; else available = value;
        }
        return total is > 0 && available is >= 0 && available <= total
            ? Result<VmMemory>.Success(new(total.Value, available.Value)) : Results.Fail<VmMemory>("unavailable", "Cannot establish host memory availability");
    }
    public static Result<Unit> Admit(ExecutionCatalog catalog, VmProfile profile, VmMemory host)
    {
        if (catalog.MemoryBudgetMiB is < 512 or > 1048576 || catalog.HostReserveMiB is < 256 or > 1048576
            || profile.MemoryMiB < 256 || profile.MaximumMemoryMiB < profile.MemoryMiB || profile.MaximumMemoryMiB > catalog.MemoryBudgetMiB
            || host.TotalKiB <= 0 || host.AvailableKiB < 0 || host.AvailableKiB > host.TotalKiB)
            return Results.Fail<Unit>("invalid", "Invalid VM resource budget or host memory information");
        var start = profile.MemoryMiB + (long)HelperMiB;
        if ((catalog.MemoryBudgetMiB + (long)catalog.HostReserveMiB) * 1024 > host.TotalKiB
            || start > catalog.MemoryBudgetMiB || (start + catalog.HostReserveMiB) * 1024 > host.AvailableKiB)
            return Results.Fail<Unit>("unavailable", "VM budget or available host memory cannot retain the configured host reserve");
        return Results.Done();
    }
    public static NativeCommand Configure(string directory, int budgetMiB)
    {
        if (budgetMiB is < 512 or > 1048576) throw new ArgumentException("Invalid fleet VM memory budget");
        return new("/usr/bin/systemctl", ["--user", "set-property", "--runtime", Slice(directory), "MemoryMax=" + Number(budgetMiB * MiB),
            "MemorySwapMax=0", "TasksMax=" + Number(Tasks)], directory, new Dictionary<string, string?>());
    }
    public static Result<NativeCommand> Service(string directory, string id, int budgetMiB, VmProfile profile, NativeCommand supervisor)
    {
        if (!Validation.Identifier(id) || !FleetConfigurationContract.Absolute(directory) || budgetMiB is < 512 or > 1048576
            || profile.MemoryMiB < 256 || profile.MaximumMemoryMiB < profile.MemoryMiB || profile.MaximumMemoryMiB > budgetMiB
            || profile.MemoryMiB + (long)HelperMiB > budgetMiB)
            return Results.Fail<NativeCommand>("invalid", "Invalid VM execution resource service");
        var maximum = Math.Min(budgetMiB, profile.MaximumMemoryMiB + (long)HelperMiB) * MiB;
        List<string> arguments = ["--user", "--quiet", "--pipe", "--wait", "--collect", "--service-type=exec", "--expand-environment=no",
            "--unit=ctlflow-execution-" + id, "--slice=" + Slice(directory), "--property=MemoryMax=" + Number(maximum),
            "--property=MemorySwapMax=0", "--property=TasksMax=" + Number(Tasks), "--property=KillMode=control-group",
            "--property=TimeoutStopSec=15s", "--working-directory=" + supervisor.Workspace];
        foreach (var variable in supervisor.Environment)
        {
            if (variable.Key is not ("DOTNET_ROOT" or "HOME" or "XDG_CONFIG_HOME" or "XDG_CACHE_HOME" or "CODEX_HOME" or "PI_CODING_AGENT_DIR")
                || variable.Value is null || !FleetConfigurationContract.Absolute(variable.Value) || variable.Value.Any(char.IsControl))
                return Results.Fail<NativeCommand>("invalid", "VM supervisor environment supports only explicit native configuration directories");
            arguments.Add("--setenv=" + variable.Key + "=" + variable.Value);
        }
        arguments.AddRange(["--", supervisor.Binary, ..supervisor.Arguments]);
        return Result<NativeCommand>.Success(new("/usr/bin/systemd-run", arguments,
            supervisor.Workspace, new Dictionary<string, string?>(), supervisor.Input));
    }
}
