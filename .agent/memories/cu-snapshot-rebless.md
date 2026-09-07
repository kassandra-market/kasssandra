---
id: memory-cu-snapshot-rebless
title: Adding Ix variants shifts CU — re-bless compute_units.snap
tags: [memory, testing, compute-units]
updated: 2026-09-07
---

# CU snapshot re-bless

`programs/oracles/tests/compute_units.snap` pins **exact** CU per instruction
for the happy-path lifecycle. Extra `Ix` match arms in `process_instruction`
add a few CU to *every* existing instruction (~5–9 in the ER/AI-oracle
dispatch expansion). That is expected, not a regression.

Re-bless without `-p` (Pod unification):

```bash
BLESS_CU=1 cargo test --workspace --test compute_units
```

Do not raise ceilings; the snapshot is exact-match on purpose.
