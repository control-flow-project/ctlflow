# Agent working agreement

`AGENTS.md` and `CLAUDE.md` are synchronized mirrors. Update both in the same
change whenever this agreement changes.

## Context-compaction checkpoint

After every context compaction, interruption, resume, or handoff, stop before
using tools or changing files and re-establish the active context from the
newest user request and retained summary.

The checkpoint must:

1. Confirm that the active project is CtlFlow at
   `/home/jeswin/repos/control-flow-project/ctlflow`.
2. Confirm the repository root, current branch, worktree state, target task,
   and relevant active processes.
3. Reject stale tasks or paths inherited from an older context.
4. State the current target before the first post-compaction edit.

Scuffle is frozen and is not an active project. Do not read, modify, run,
reset, or otherwise operate on Scuffle unless the user explicitly reactivates
it in a new request. Never infer Scuffle work from a stale summary or working
directory.
