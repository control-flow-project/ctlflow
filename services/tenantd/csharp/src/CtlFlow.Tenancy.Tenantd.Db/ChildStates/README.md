# Child-state persistence placeholder

This directory will own fixed EF operations for lifecycle-step state and
idempotent acknowledgements. Each public persistence operation gets one
verb-named file and a fresh pooled context.

No downstream call may occur while a database transaction is open.
