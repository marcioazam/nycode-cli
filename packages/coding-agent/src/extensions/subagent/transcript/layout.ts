/** Theme plumbing and the two small tui components the transcript needs: an indented child and a capped, wrapped line. */

import type { Theme } from '../../../modes/interactive/theme/theme.ts'
import { type Component, Text, truncateToWidth, visibleWidth } from '@nycode/tui'

import { noColor } from '../fleet-ui/style/palette.ts'

export type T = Pick<Theme, 'fg' | 'bold'>

const PLAIN = { fg: (_role: string, text: string) => text, bold: (text: string) => text } as T
// NO_COLOR is read per render, so a toggle takes effect on the next redraw.
export const themed = (theme: Theme): T => (noColor() ? PLAIN : theme)

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** Renders a child narrower by the prefix width and puts the prefix before each line (the tree's vertical bar). */
export class Indent implements Component {
  private readonly child: Component
  private readonly prefix: string

  constructor(child: Component, prefix: string) {
    this.child = child
    this.prefix = prefix
  }

  render(width: number): string[] {
    const inner = Math.max(1, width - visibleWidth(this.prefix))
    return this.child.render(inner).map((line) => this.prefix + line)
  }

  invalidate(): void {
    this.child.invalidate()
  }
}

/** Text wrapped to the width after a prefix and capped at `cap` lines; the cut ends in an ellipsis. */
export class Wrapped implements Component {
  private readonly first: string
  private readonly rest: string
  private readonly text: string
  private readonly cap: number
  private readonly ellipsis: string

  constructor(first: string, rest: string, text: string, cap: number, ellipsis: string) {
    this.first = first
    this.rest = rest
    this.text = text
    this.cap = cap
    this.ellipsis = ellipsis
  }

  render(width: number): string[] {
    const inner = Math.max(2, width - visibleWidth(this.first))
    const lines = new Text(this.text, 0, 0).render(inner).map((l) => l.trimEnd())
    if (lines.length > this.cap) {
      lines.length = this.cap
      lines[this.cap - 1] = truncateToWidth(lines[this.cap - 1], inner - 1, '', false) + this.ellipsis
    }
    return lines.map((line, i) => (i === 0 ? this.first : this.rest) + line)
  }

  invalidate(): void {}
}
