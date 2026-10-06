# Fleet stop and management navigation

## Incident

The Agreements controller completed the requested fleet stop on 7 October 2026
at 00:05:53 IST. All 28 instances were stopped and their saved histories retained.
Crossfire still showed the operation as running and disabled Resume.

The operation receipt handler also attempted to manufacture native-stop
retirement proofs for every latest listener run. Some runs belonged to older
controller generations. Their correct generation checks rejected the operation's
transaction. Reconnects created new generations without resolving that mismatch.
The UI separately presented historical native activity as a prominent badge.

## Owning fixes

- Crossfire accepts final lifecycle outcomes from the currently authenticated,
  claimed controller generation without synthesizing native-stop proofs.
- Retirement keeps its exact native-close, current-run, current-lease and receipt
  requirements. Successful stop operations do not weaken that authority.
- The controller worker acknowledges an already-final reclaimed operation without
  reexecuting native work. Operation identity and saved histories remain intact.
- Batched latest-run summaries distinguish confirmed Stopped from unverified
  offline observations. History availability remains a separate measurement.
- Fleet controls and operation history live at `/manage/fleets/{fleetId}/sessions`.
  Controls observe current operations even while browsing older history pages.
- Management confirmations share a themed, accessible modal with pending/error
  handling. The wake audience picker is a URL-addressable page with Back/Cancel.

## Recovery and verification

The rollout must preserve production state and native history, verify consistent
backups before activation, settle the existing controller operation through the
normal receipt path, and restore the exact pre-stop enabled instances. Previously
stopped instances remain stopped. No fresh history, database reset, new identity
or unsolicited task is part of this recovery.

Regression coverage includes mixed historical generations, receipt replay,
lease rollover/reclaim, strict retirement rejection, per-agent stop scope,
later reporting generations, current-operation controls on historical pages,
themed confirmation focus/cancel/pending/failure handling, and wake-page drafts,
direct URLs, mobile layout and revision conflicts.

## Integrated source results

- Typecheck and all service builds passed.
- All 687 tests passed across 158 isolated files on 24 parallel workers; no
  failures or cancellations. Test execution took 96.577 seconds after preparation.
- All 33 architecture checks and four public installation checks passed.
- Container checks passed for startup, native Matrix/Element routes, authenticated
  attachment downloads, management, artifacts, shutdown and persisted rooms.
- The immutable listener release is `0.1.8-2fa06475ac6a316a2511f041`.

These are integrated source and native-fixture results, not a claim that every
real model task or production failure mode has been certified. The production
rollout separately verifies backups, release identity, operation settlement,
preserved accounts/rooms/native histories and real management browser flows.
