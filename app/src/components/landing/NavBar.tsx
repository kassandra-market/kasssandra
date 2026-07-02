import { Button } from '../ui'

const NAV_LINKS: { label: string; href: string }[] = [
  { label: 'Protocol', href: '#how-it-works' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Governance', href: '#why-kassandra' },
  { label: 'Docs', href: '#' },
]

// On-brand focus ring (sepia, never default blue) for the plain text links.
const linkFocus =
  'rounded-sm focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-sepia/40 focus-visible:ring-offset-2 focus-visible:ring-offset-soft-cream'

/**
 * Delphi top bar — soft-cream, a single hairline bottom border, not sticky.
 * Left links · centered serif wordmark · right actions. The "Connect wallet"
 * NavPill is a PLACEHOLDER (renders on-brand, not wired to wallet-adapter —
 * that ships in the next milestone).
 */
export default function NavBar() {
  return (
    <nav
      aria-label="Primary"
      className="border-b border-pebble bg-soft-cream"
    >
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-6 py-4">
        {/* Left: primary links (hidden on small screens) */}
        <ul className="hidden flex-1 items-center gap-6 md:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.label}>
              <a
                href={l.href}
                className={`font-inter text-[14px] text-bronze transition-colors hover:text-sepia ${linkFocus}`}
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        {/* Center: wordmark */}
        <a
          href="#top"
          className={`font-serif text-[26px] font-light tracking-[-0.01em] text-sepia ${linkFocus}`}
        >
          Kassandra
        </a>

        {/* Right: actions */}
        <div className="flex flex-1 items-center justify-end gap-3">
          <a
            href="#how-it-works"
            className={`hidden font-inter text-[14px] font-medium text-sepia transition-colors hover:text-ember-orange sm:inline ${linkFocus}`}
          >
            Explore
          </a>
          <Button
            variant="NavPill"
            title="Wallet connect ships in the next milestone"
            aria-label="Connect wallet (coming soon)"
            onClick={(e) => e.preventDefault()}
          >
            Connect wallet
          </Button>
        </div>
      </div>
    </nav>
  )
}
