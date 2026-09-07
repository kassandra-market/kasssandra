/**
 * The current SOL→USD (USDC) price for the trade UI's unit toggle, or `null`
 * when unavailable (governance unlinked / no DAO spot TWAP yet / mock mode) — in
 * which case the caller disables USD display. Reads the governance-anchored
 * futarchy spot TWAP ({@link fetchSolUsdcPrice}); polls slowly since the TWAP
 * moves on the order of minutes, not seconds. Best-effort: any failure → `null`.
 */
import { useEffect, useState } from "react";

import { useConnection } from "../lib/cluster";
import { fetchSolUsdcPrice } from "../data/spotPrice";
import { isMockMode } from "../data/mockOracles";

/** Poll cadence (ms). The spot TWAP is slow-moving — a light refresh suffices. */
const POLL_MS = 60_000;

export function useSolUsdcPrice(): number | null {
  const { connection } = useConnection();
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => {
    // Mock mode has no live connection — USD stays disabled offline.
    if (isMockMode()) {
      setPrice(null);
      return;
    }
    let active = true;
    const load = () => {
      fetchSolUsdcPrice(connection).then(
        (p) => {
          if (active) setPrice(p);
        },
        () => {
          if (active) setPrice(null);
        },
      );
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [connection]);

  return price;
}
