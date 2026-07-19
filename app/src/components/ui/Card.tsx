import type { HTMLAttributes, ReactNode } from 'react'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

/**
 * Auros content card. Pure-card surface, 16px radius, 24px padding,
 * a single 1px pebble hairline border. Flat — NO heavy drop shadow (the only
 * shadow in the system is the chestnut button's peach bloom).
 */
export function Card({ className = '', children, ...rest }: CardProps) {
  return (
    <div
      className={`bg-liquid-kelp rounded-card border border-hairline p-6 ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}

export default Card
