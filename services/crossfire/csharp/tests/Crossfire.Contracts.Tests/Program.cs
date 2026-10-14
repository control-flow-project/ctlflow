using Crossfire.Storage.Tests;
using System.Runtime.CompilerServices;
using System.Text.Json;

RoomAcceptance.Verify();
Console.WriteLine($"Contract checks passed: {Checks.Passed}; dynamic code: {RuntimeFeature.IsDynamicCodeSupported}; reflection JSON: {JsonSerializer.IsReflectionEnabledByDefault}");
