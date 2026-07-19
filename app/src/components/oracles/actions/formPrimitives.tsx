import { useId, type ReactNode } from 'react'
import { Button } from '../../ui'
import type { WriteStatus } from '../../../data/writeAction'

const inputClass =
  'w-full rounded-tag border border-hairline bg-liquid-kelp px-3 py-2 font-inter text-[14px] ' +
  'text-platinum placeholder:text-silver focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-platinum/40 focus-visible:ring-offset-2 focus-visible:ring-offset-liquid-abyss ' +
  'aria-[invalid=true]:border-coral/60'

/**
 * A labelled field wrapper: a serif-lite label, the control, and inline error
 * text associated to the control via `aria-describedby` (the child input reads
 * `describedById` + `invalid`). Auros: hairline inputs, ember only for the
 * inline error text.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: ReactNode
  error?: string
  children: (ids: { id: string; describedById: string; invalid: boolean }) => ReactNode
}) {
  const id = useId()
  const describedById = `${id}-desc`
  const invalid = Boolean(error)
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-inter text-[13px] font-medium text-platinum">
        {label}
      </label>
      {children({ id, describedById, invalid })}
      <p id={describedById} className="font-inter text-[12px] min-h-[1rem]">
        {error ? (
          <span className="text-coral">{error}</span>
        ) : hint ? (
          <span className="text-silver">{hint}</span>
        ) : null}
      </p>
    </div>
  )
}

/** A plain text/number input pre-wired to a {@link Field}'s ids. */
export function TextInput({
  ids,
  className = '',
  ...rest
}: {
  ids: { id: string; describedById: string; invalid: boolean }
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      id={ids.id}
      aria-describedby={ids.describedById}
      aria-invalid={ids.invalid}
      className={`${inputClass} ${className}`}
      {...rest}
    />
  )
}

/**
 * The chestnut submit button whose label reflects the write status:
 * `idle → verb` · building → "Preparing…" · signing → "Signing…" ·
 * confirming → "Confirming…". Disabled while busy or when `disabled`.
 */
export function SubmitButton({
  verb,
  status,
  disabled,
}: {
  verb: string
  status: WriteStatus
  disabled?: boolean
}) {
  const label =
    status.kind === 'building'
      ? 'Preparing…'
      : status.kind === 'signing'
        ? 'Signing…'
        : status.kind === 'confirming'
          ? 'Confirming…'
          : verb
  const busy =
    status.kind === 'building' || status.kind === 'signing' || status.kind === 'confirming'
  return (
    <Button type="submit" variant="PrimaryChestnut" disabled={disabled || busy} aria-busy={busy}>
      {label}
    </Button>
  )
}
