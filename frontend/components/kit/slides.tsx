"use client"

/**
 * Story slide deck — `<SlideDeck>` / `<Slide>`, the presentation layout for `format:'jsx'`
 * stories (the `deck` template's slide recipe as a component). NOT vendored shadcn: authored
 * for the story registry, but it lives in kit/ because the registry maps story tags to this
 * directory and the recipe-class extractor scans it (all classes below must stay LITERAL).
 *
 * Pure stacked flow: each Slide is a full-viewport section (`--mx-vh` is the host viewport
 * height stamped on the surface root by lib/story-surface; vh units are broken inside
 * <svg><foreignObject>, and the 760px fallback covers headless renders). Nothing here is
 * interactive and no JS measures anything, so captures serialize by construction.
 *
 * The `data-mx-slide` / `data-mx-slide-title` stamps are the render-side contract the PARENT
 * document's slide navigation (birds-eye rail, present-mode controls) discovers slides
 * through — see lib/story-ui/slide-nav.ts. They are render artifacts: the data-mx-* prefix
 * strip in lib/data/story/jsx-edit.ts keeps them out of any WYSIWYG write-back.
 */
import * as React from "react"

import { cn } from "./cn"

export type SlideDeckProps = React.ComponentProps<"div">

export interface SlideProps extends React.ComponentProps<"section"> {
  /** Short name shown in the birds-eye rail / present counter; navigation falls back to the slide's first heading. */
  title?: string
}

function SlideDeck({ className, children, ...props }: SlideDeckProps) {
  return (
    <div className={cn("@container w-full", className)} {...props}>
      {children}
    </div>
  )
}

function Slide({ title, className, children, ...props }: SlideProps) {
  return (
    <section
      data-mx-slide=""
      {...(title !== undefined ? { "data-mx-slide-title": title } : {})}
      // No w-full: an explicit 100% width would break the full-bleed divider recipe
      // (negative side margins over a fixed width leave the right edge short); a block
      // section fills its container by itself.
      className={cn("relative flex flex-col min-h-[var(--mx-vh,760px)]", className)}
      {...props}
    >
      {children}
    </section>
  )
}

export { SlideDeck, Slide }
