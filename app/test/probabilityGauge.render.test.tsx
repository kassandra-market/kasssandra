/**
 * Render coverage for the market implied-probability gauge. Asserts the arc fill
 * tracks the YES share (normalized `pathLength=100` → `strokeDasharray="yes 100"`),
 * the YES/NO read-out is real text (never colour-only), and a null pool degrades
 * to a calm placeholder instead of collapsing the tab.
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ProbabilityGauge } from '../src/components/markets/ProbabilityGauge'

describe('ProbabilityGauge', () => {
  it('fills the arc to the rounded YES share and shows both legs', () => {
    const html = renderToStaticMarkup(<ProbabilityGauge probability={0.64} />)
    expect(html).toContain('stroke-dasharray="64 100"')
    expect(html).toContain('YES 64%')
    expect(html).toContain('NO 36%')
    expect(html).toContain('aria-valuenow="64"')
  })

  it('degrades to a placeholder when the pool is unreadable', () => {
    const html = renderToStaticMarkup(<ProbabilityGauge probability={null} />)
    expect(html).toContain('Live price unavailable')
    expect(html).not.toContain('stroke-dasharray')
  })
})
