using System.Runtime.InteropServices;
using Fleet.Cli;

using var stopping = new CancellationTokenSource();
using var interrupt = PosixSignalRegistration.Create(PosixSignal.SIGINT, context => { context.Cancel = true; stopping.Cancel(); });
using var terminate = PosixSignalRegistration.Create(PosixSignal.SIGTERM, context => { context.Cancel = true; stopping.Cancel(); });
try { await Commands.Run(arguments: args, TimeProvider.System, stopping.Token); }
catch (Exception error) when (error is CommandFailure or IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException or System.Text.Json.JsonException or OperationCanceledException)
{ Console.Error.WriteLine(stopping.IsCancellationRequested ? "CLI disconnected; accepted operations continue in fleetd" : error.Message); Environment.ExitCode = 1; }
