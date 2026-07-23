import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export interface ManagedProcess {
  readonly child: ChildProcessByStdio<null, Readable, Readable>;
  readonly diagnostics: () => string;
}
