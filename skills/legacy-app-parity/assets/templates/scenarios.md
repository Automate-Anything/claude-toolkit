# Business scenarios: {{SYSTEM}}

Progress is measured by whole tasks a staff member does end to end, not by
screens. A screen can pass its layout diff while the task still breaks between
screens. One scenario per top task from the owner, most-used first.

Each scenario is a characterization test: the inputs and every observable
output recorded from the OLD system, replayed on the new app, outputs compared.
Fields that differ between two runs of the OLD system (timestamps, generated
numbers) are noise: mask them before comparing old with new.

## SC01 (task name, e.g. "Take a payment at the front desk")

- Who does it, how often: 
- Start: (screen, state)
- Steps (exact clicks, keys, values):
  1. 
- Outputs recorded from the old system: screens reached, messages, values,
  totals, numbers generated, exports, emails, status changes
- Noise fields masked: 
- Evidence: `_raw/...`
- New app result: not run / PASS / FAIL (what differed)
- Can it be NOT_COMPARABLE? Say why (AUTH_BLOCKED, DATA_MISMATCH, NOT_READY). That is never a pass.
