import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Address } from "@solana/web3.js";
import { useOracles } from "../../../../hooks/useOracles";
import { useOracleMeta } from "../../../../hooks/useOracleMeta";
import { fuzzySearch } from "../../../../lib/fuzzySearch";
import { shortSig } from "../../../../market/lib/explorer";

const TOP_K = 8;

const inputClass =
  "w-full rounded-tag border border-hairline bg-liquid-kelp px-3 py-2 font-inter text-[14px] " +
  "text-platinum placeholder:text-silver focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-platinum/40 focus-visible:ring-offset-2 focus-visible:ring-offset-liquid-abyss " +
  "aria-[invalid=true]:border-coral/60";

/** Whether `text` parses as a structurally valid base58 Solana pubkey. */
function isValidAddress(text: string): boolean {
  try {
    new Address(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The oracle field for {@link CreateMarketForm}: type the oracle's TITLE
 * (subject) and fuzzy-search across every loaded oracle, picking from the
 * top {@link TOP_K} matches in a dropdown — or paste a full oracle pubkey
 * directly (the existing power-user path), which commits immediately without
 * needing a dropdown pick (the caller's own indexer-based read then confirms
 * whether it's a real oracle, exactly as before this component existed).
 *
 * Uncontrolled-ish by design: this component owns its own query text and
 * emits the committed pubkey via `onChange`; it does not resync its displayed
 * text from an externally-changed `value`, to keep a first combobox
 * implementation in this codebase simple (there is no Popover/Combobox
 * primitive here yet — see the Auros `formPrimitives.tsx` for the styling
 * conventions this borrows).
 */
export function OraclePicker({
  onChange,
  ids,
}: {
  /** Called with the committed oracle pubkey, or `""` when cleared/uncommitted. */
  onChange: (pubkey: string) => void;
  ids: { id: string; describedById: string; invalid: boolean };
}) {
  const { data: oracles } = useOracles();
  const pubkeys = useMemo(() => (oracles ?? []).map((o) => o.pubkey), [oracles]);
  const meta = useOracleMeta(pubkeys);

  const candidates = useMemo(
    () => (oracles ?? []).map((o) => ({ pubkey: o.pubkey, subject: meta.get(o.pubkey)?.subject })),
    [oracles, meta],
  );

  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const matches = useMemo(
    () => (committed ? [] : fuzzySearch(query, candidates, (c) => [c.subject ?? "", c.pubkey], TOP_K)),
    [query, candidates, committed],
  );
  const showDropdown = isOpen && matches.length > 0;

  function commit(pubkey: string, label: string) {
    setCommitted(pubkey);
    setQuery(label);
    setIsOpen(false);
    onChange(pubkey);
  }

  function handleChange(next: string) {
    setQuery(next);
    setHighlighted(0);
    const trimmed = next.trim();
    if (isValidAddress(trimmed)) {
      // Paste path: commit immediately, matched oracle or not — the parent's
      // own indexer read is the source of truth on whether it's real.
      setCommitted(trimmed);
      setIsOpen(false);
      onChange(trimmed);
      return;
    }
    if (committed) {
      setCommitted("");
      onChange("");
    }
    setIsOpen(true);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const m = matches[highlighted];
      if (m) {
        e.preventDefault();
        commit(m.item.pubkey, m.item.subject ?? shortSig(m.item.pubkey));
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        id={ids.id}
        aria-describedby={ids.describedById}
        aria-invalid={ids.invalid}
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={`${ids.id}-listbox`}
        aria-autocomplete="list"
        autoComplete="off"
        inputMode="text"
        placeholder="Type the oracle's question, or paste its address"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          // A dropdown click fires blur before its own click handler; defer the
          // close so the click still registers (mousedown-preventDefault below
          // is the primary guard — this timer is a defensive fallback for
          // pointer types where that doesn't apply, e.g. some touch browsers).
          blurTimer.current = setTimeout(() => setIsOpen(false), 100);
        }}
        className={inputClass}
      />
      {showDropdown ? (
        <ul
          id={`${ids.id}-listbox`}
          role="listbox"
          aria-label="Matching oracles"
          className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-tag border border-hairline bg-liquid-kelp py-1 shadow-lg"
        >
          {matches.map((m, i) => (
            <li
              key={m.item.pubkey}
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus on the input; suppress the pending blur-close
                clearTimeout(blurTimer.current);
                commit(m.item.pubkey, m.item.subject ?? shortSig(m.item.pubkey));
              }}
              onMouseEnter={() => setHighlighted(i)}
              className={`cursor-pointer px-3 py-2 font-inter text-[13px] transition-colors ${
                i === highlighted ? "bg-hairline/50 text-platinum" : "text-silver"
              }`}
            >
              <span className="block truncate text-platinum">{m.item.subject ?? "Untitled oracle"}</span>
              <span className="block truncate font-mono text-[11px] text-silver-dim">
                {shortSig(m.item.pubkey)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default OraclePicker;
