# Fleet CLI service
Follow ../../AGENTS.md and ../../docs/specification.md.
Own commands, output, API client and SSH transport. All orchestration uses fleetd's
API even locally. Do not launch runtimes, access daemon private state directly,
duplicate enrollment or import another application's source.
