---
id: memory-cu-snapshot-rebless
title: Adding Ix variants shifts CU — re-bless compute_units.snap
tags: [memory, testing, compute-units]
updated: 2026-09-08
---

# CU snapshot re-bless

`programs/oracles/tests/compute_units.snap` pins **exact** CU per instruction
for the happy-path lifecycle. Extra `Ix` match arms in `process_instruction`
(and extra 8-byte callback intercepts in `lib.rs`) add a few CU to *every*
existing instruction. Removing work (e.g. dropping the `MintTo` from
`create_oracle`) drops CU on that instruction only. That is expected, not a
regression.

Re-bless without `-p` (Pod unification):

```bash
BLESS_CU=1 cargo test --workspace --test compute_units
```

Do not raise ceilings; the snapshot is exact-match on purpose.
