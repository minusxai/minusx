"use client"

/**
 * Story layout grid — `<Grid>` / `<GridItem>`, the dashboard-style positioned layout for
 * `format:'jsx'` stories. NOT vendored shadcn: authored for the story registry, but it lives
 * in kit/ because the registry maps story tags to this directory and the recipe-class
 * extractor scans it (all positioning classes below must stay LITERAL, and every calc()
 * must stay space-free — the extractor splits string literals on whitespace).
 *
 * View mode is pure CSS: items are absolutely positioned from CSS variables
 * (--g-cols/--g-rh on the grid, --gi-x/--gi-y/--gi-w/--gi-h per item) with the same
 * arithmetic edit-mode react-grid-layout uses at margin [0,0] — see lib/story-ui/grid-layout.ts.
 * Below the @2xl container width, items stack in source order (position static, full width)
 * but KEEP their computed px height, because embeds inside fill the cell at 100%.
 *
 * `editing` is internal — set by StoryJsxBody's edit-mode adapter via cloneElement, never
 * authored: react-grid-layout positions its own wrapper, so the item must stop
 * self-positioning or the two would fight.
 */
import * as React from "react"

import { cn } from "./cn"

/** True inside a `<GridItem>` — embeds consume this to fill the cell instead of an authored height. */
export const GridItemContext = React.createContext(false)

export interface GridProps extends React.ComponentProps<"div"> {
  /** Column count, default 12 (clamped 1–24). */
  cols?: number
  /** Row height in px, default 86 (clamped 20–400). */
  rowHeight?: number
}

export interface GridItemProps extends React.ComponentProps<"div"> {
  x?: number
  y?: number
  w?: number
  h?: number
  /** Internal (edit-mode adapter only): the RGL wrapper positions; the item fills it. */
  editing?: boolean
}

/** The GridItem children of a Grid, in source order — everything else (whitespace text,
 *  stray elements) is dropped: a positioned grid has no place for flow content. */
export function gridItemChildren(children: React.ReactNode): React.ReactElement<GridItemProps>[] {
  throw new Error("not implemented")
}

function Grid(_props: GridProps) {
  throw new Error("not implemented")
}

function GridItem(_props: GridItemProps) {
  throw new Error("not implemented")
}

export { Grid, GridItem }
