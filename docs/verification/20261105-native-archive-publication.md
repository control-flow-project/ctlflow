# Native archive publication — 5 November 2026

The existing tested ctlflow 0.1.26 Linux x64 archives were published without
rebuilding or changing their bytes. The release tag targets source commit
`50347261a3c4fc7e5ffd2dcf4f530b76f144acab`.

- [Public native release v0.1.26](https://github.com/control-flow-project/ctlflow/releases/tag/v0.1.26)

At 2026-11-05T04:46:05.900444+00:00, an unauthenticated client downloaded every complete
asset through its public browser-download URL. The client read no credential
file and sent no authorization header. All responses were HTTP 200; byte counts
and SHA256 values matched the preserved tested files and the public checksum file.

| Asset | Bytes | SHA256 | Download seconds |
| --- | ---: | --- | ---: |
| `ctlflow-csharp-managed-0.1.26-linux-x64.tar.gz` | 145682999 | `82c1d0edc7686b8ce283e6cb6138372b31ec47267b260c9e57234defb0f20f44` | 19.63 |
| `ctlflow-csharp-nativeaot-0.1.26-linux-x64.tar.gz` | 84139890 | `77374b017ad94d1a2645ae3db32b2c578365b07d2674c236b7938d05a2330161` | 10.327 |
| `ctlflow-rust-0.1.26-linux-x64.tar.gz` | 22574286 | `6d73adf3b6e7a4ec914d35cb481818d1ec02a0fedca116c86d8aa3ccb17231c9` | 63.843 |
| `SHA256SUMS` | 331 | `b59dafb6769d796fd86916e11db5d9962ef63166281c3c741d3c26751157a77a` | 1.709 |

The four sequential downloads transferred 252397506 bytes in 95.51 seconds.
Publication took 23.937 seconds, including all four uploads. These durations
measure this workstation and network, not application performance.

This check verifies publication and byte identity. The product test and deployment
results remain those in the [4 November record](20261104-native-release.md);
they were not rerun for this documentation-only availability update.

Repository guides now describe the public native archives. Website availability
copy is updated in a separate coordinated documentation branch; Netlify publishes
that website after the maintainer merges its PR. No services or agents were restarted.
