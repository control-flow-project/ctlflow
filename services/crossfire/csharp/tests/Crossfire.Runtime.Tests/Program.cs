using System.Runtime.CompilerServices;
using Crossfire.Runtime.Tests;
using System.Runtime.Versioning;

[assembly: SupportedOSPlatform("linux")]

if (args.Length != 0) throw new ArgumentException("Runtime acceptance takes no optional suite flags");
await ProtocolAcceptance.Verify();
await SignalAcceptance.Verify();
ConfigurationAcceptance.Verify();
NativeValuesAcceptance.Verify();
await ProcessAcceptance.Verify();
await ModelAcceptance.Verify();
HistoryAcceptance.Verify();
await CodexAcceptance.Verify();
await PiAcceptance.Verify();
await PiProtocolAcceptance.Verify();
await OwnedPiAcceptance.Verify();
await DeliveryAcceptance.Verify();
Console.WriteLine("{\"status\":\"passed\",\"scope\":\"implemented runtime transport\",\"assertions\":" + Checks.Passed
    + ",\"dynamicCode\":" + (RuntimeFeature.IsDynamicCodeSupported ? "true" : "false") + "}");
