"use client"

/**
 * Story layout grid — `<Grid>` / `<GridItem>`, the dashboard-style positioned layout for
 * `format:'jsx'` stories. NOT vendored shadcn: authored for the story registry, but it lives
 * in kit/ because the registry maps story tags to this directory and the recipe-class
 * extractor scans it (all positioning classes below must stay LITERAL, and every calc()
 * must stay space-free — the extractor splits string literals on whitespace).
 *
 * View mode is pure CSS: items are absolutely positioned from CSS variables
 * (--g-cols/--g-rh/--g-rows on the grid, --gi-x/--gi-y/--gi-w/--gi-h per item) with the
 * same arithmetic edit-mode react-grid-layout uses at margin [0,0] — see
 * lib/story-ui/grid-layout.ts. Below the @2xl container width, items stack in source order
 * (position static, full width) but KEEP their computed px height, because embeds inside
 * fill the cell at 100%. The 6px gutter is p-[3px] INSIDE each item, so RGL needs no margin
 * and both modes place identically.
 *
 * `editing` is internal — set by StoryJsxBody's edit-mode adapter via cloneElement, never
 * authored: react-grid-layout positions its own wrapper, so the item must stop
 * self-positioning or the two would fight.
 */
import * as React from "react"

import { cn } from "./cn"
import { gridCols, gridRowHeight, gridItemRect, gridRows } from "@/lib/story-ui/grid-layout"

/** True inside a `<GridItem>` — embeds consume this to fill the cell instead of an authored height. */
export const GridItemContext = React.createContext(false)

/** The grid's resolved column count, inherited by GridItems for rect clamping. */
const GridColsContext = React.createContext(12)

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
  const out: React.ReactElement<GridItemProps>[] = []
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === GridItem) {
      out.push(child as React.ReactElement<GridItemProps>)
    }
  })
  return out
}

function Grid({ cols, rowHeight, className, style, children, ...props }: GridProps) {
  const nCols = gridCols(cols)
  const rh = gridRowHeight(rowHeight)
  const items = gridItemChildren(children)
  const rows = gridRows(items.map((el) => gridItemRect(el.props, nCols)))
  return (
    <div
      className={cn("@container w-full", className)}
      style={{
        ...style,
        "--g-cols": String(nCols),
        "--g-rh": `${rh}px`,
        "--g-rows": String(rows),
      } as React.CSSProperties}
      {...props}
    >
      <GridColsContext.Provider value={nCols}>
        <div className="relative w-full h-[calc(var(--g-rows)*var(--g-rh))] @max-2xl:h-auto">
          {items}
        </div>
      </GridColsContext.Provider>
    </div>
  )
}

function GridItem({ x, y, w, h, editing, className, style, children, ...props }: GridItemProps) {
  const cols = React.useContext(GridColsContext)
  const rect = gridItemRect({ x, y, w, h }, cols)
  return (
    <div
      className={cn(
        "overflow-hidden p-[3px]",
        editing
          ? "size-full"
          : "absolute left-[calc(var(--gi-x)/var(--g-cols)*100%)] top-[calc(var(--gi-y)*var(--g-rh))] w-[calc(var(--gi-w)/var(--g-cols)*100%)] h-[calc(var(--gi-h)*var(--g-rh))] @max-2xl:static @max-2xl:w-full",
        className
      )}
      style={{
        ...style,
        "--gi-x": String(rect.x),
        "--gi-y": String(rect.y),
        "--gi-w": String(rect.w),
        "--gi-h": String(rect.h),
      } as React.CSSProperties}
      {...props}
    >
      <GridItemContext.Provider value={true}>{children}</GridItemContext.Provider>
    </div>
  )
}

export { Grid, GridItem }
