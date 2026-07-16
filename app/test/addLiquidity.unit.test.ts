/**
 * Unit tests for the add-liquidity write action's input guard. The balanced-split
 * and gross-LP accounting are proven end-to-end in the program's LiteSVM tests
 * (`programs/markets/tests/add_liquidity.rs`); here we lock the client-side
 * amount guard that fires before any SDK/address work.
 */
import { describe, expect, it } from "vitest";

import { buildAddLiquidityIxs } from "../src/market/data/actions/addLiquidity";
import { ValidationError } from "../src/market/data/writeAction";

// A minimal stand-in — the amount guard rejects before these are ever read.
const stub = {
  market: "11111111111111111111111111111111",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  marketAccount: {} as any,
  reserves: { base: 1_000n, quote: 1_000n },
  contributor: "11111111111111111111111111111111",
};

describe("buildAddLiquidityIxs amount guard", () => {
  it("rejects a zero amount with a typed ValidationError", async () => {
    await expect(buildAddLiquidityIxs({ ...stub, amount: 0n })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rejects a negative amount", async () => {
    await expect(buildAddLiquidityIxs({ ...stub, amount: -5n })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
