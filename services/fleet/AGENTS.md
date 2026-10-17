# fleet CLI service
Follow ../../AGENTS.md and ../../docs/specification.md.
Own commands, output, API client and SSH transport. All orchestration uses fleetd's
API even locally. Do not launch runtimes, access daemon private state directly,
duplicate enrollment or import another application's source.
Runtime TUI pointers use the shared runtime terminal adapter and the daemon's
private attachment API. Native commands/settings stay in that adapter; SSH owns
remote command wrapping. The human launches the native client, not the fleet CLI.
