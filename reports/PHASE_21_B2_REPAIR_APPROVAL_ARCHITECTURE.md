# Phase 21 — B-2 Repair Approval Architecture

## 1. Implementation

New module: `src/reliability/repair-approval.ts` — `RepairApprovalStore` class.

Lifecycle: `detected → diagnosis → repair_proposed → awaiting_approval → approved/rejected/expired →
ready_for_execution → verification → completed/failed`.

## 2. Approval record fields

Proposal ID, finding ID, component, root cause, proposed action, expected benefit, potential side
effects, risk classification, required permissions, expected downtime, rollback possible, created/expires
timestamps, status, approval identity, decision timestamp, decision reason, audit reference, action hash.

## 3. Security properties

- Approval requires non-empty identity and reason.
- Duplicate decisions rejected.
- Expiration enforced (TTL-based).
- Action hash binds approval to the exact reviewed action (re-approval required if action changes).
- Approval moves to `ready_for_execution` but does NOT execute the repair.
- `markCompleted`/`markFailed` only callable from `ready_for_execution`.
- Audit events written to `security_events` when table exists (best-effort, never blocks).

## 4. Tests

`src/__tests__/reliability/repair-approval.test.ts` — **15 tests, all passing.**

Covers: creation, approval, rejection, duplicate decisions, identity/reason requirements, expiration,
action hash binding, markCompleted/markFailed state guards, listing, unknown proposal.

## 5. Acceptance

**IMPLEMENTED AND TESTED.** The approval lifecycle, authorization, audit history, and non-execution
boundary all pass. No actual repair is executed by the approval flow.
