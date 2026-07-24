"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "./cn"

const TooltipPortalContext = React.createContext(true)

type TooltipSide = "top" | "right" | "bottom" | "left"
type TooltipAlign = "start" | "center" | "end"
type TooltipPlacement = TooltipSide | `${TooltipSide}-${Exclude<TooltipAlign, "center">}`

type TooltipRootProps = React.ComponentProps<typeof TooltipPrimitive.Root>

export interface TooltipProps extends Omit<TooltipRootProps, "children"> {
  children: React.ReactElement
  content: React.ReactNode
  contentProps?: Omit<React.ComponentProps<typeof TooltipPrimitive.Content>, "children"> & {
    portalled?: boolean
  }
  disabled?: boolean
  portalled?: boolean
  positioning?: {
    placement?: TooltipPlacement
    gutter?: number
  }
}

function TooltipProvider({
  delayDuration = 300,
  portalled,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider> & {
  /**
   * App tooltips portal to the document by default so transformed and
   * overflow-hidden panels cannot clip or offset them. Story embeds opt out
   * once at their root because portals do not work inside foreignObject.
   */
  portalled?: boolean
}) {
  const inheritedPortalled = React.useContext(TooltipPortalContext)

  return (
    <TooltipPortalContext.Provider value={portalled ?? inheritedPortalled}>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        skipDelayDuration={100}
        {...props}
      />
    </TooltipPortalContext.Provider>
  )
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

// STORY PATCH vs shadcn source: stories render inside <svg><foreignObject>,
// where `position: fixed` (which Radix's Portal + Popper rely on) is broken.
// StoryJsxBody sets TooltipProvider portalled={false}, so content stays inline
// inside the story root. Radix still wraps content in an internal
// `[data-radix-popper-content-wrapper]` div with `position: fixed`; the story
// stylesheet must include STORY_FLOATING_CSS (see ../floating.ts) to force it to
// `absolute`. `collisionBoundary` is left at its default; the mounting code
// should pass the story root as the collision boundary via props where possible.
function TooltipContent({
  className,
  sideOffset = 6,
  collisionPadding = 8,
  portalled,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  /** Override the nearest provider's portal behavior for an exceptional host. */
  portalled?: boolean
}) {
  const inheritedPortalled = React.useContext(TooltipPortalContext)
  const content = (
    <TooltipPrimitive.Content
      data-slot="tooltip-content"
      data-story-floating=""
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        "pointer-events-none z-[100] w-max max-w-[min(28rem,calc(100vw-1rem))] whitespace-normal origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md bg-foreground px-2.5 py-1.5 text-left text-xs leading-normal text-background shadow-md fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
        className
      )}
      {...props}
    >
      {children}
      <TooltipPrimitive.Arrow className="z-[100] size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
    </TooltipPrimitive.Content>
  )

  return (portalled ?? inheritedPortalled)
    ? (
        <TooltipPrimitive.Portal>
          {/* Theme tokens are scoped to data-mx-theme-host. A body portal is
              outside the app/file host, so it must carry its own token scope. */}
          <div data-mx-theme-host="">{content}</div>
        </TooltipPrimitive.Portal>
      )
    : content
}

/**
 * The single app tooltip supports both the Radix compound API and the compact
 * `content="…"` form used by older call sites.
 */
function Tooltip(props: TooltipRootProps | TooltipProps) {
  if (!("content" in props)) {
    return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
  }

  const {
    children,
    content,
    contentProps,
    disabled,
    portalled = true,
    positioning,
    ...rootProps
  } = props

  if (disabled) return children

  const [side = "top", placementAlign] = (positioning?.placement ?? "top").split("-") as [TooltipSide, TooltipAlign?]
  const align = placementAlign ?? "center"

  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...rootProps}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          align={align}
          sideOffset={positioning?.gutter}
          portalled={portalled}
          {...contentProps}
        >
          {content}
        </TooltipContent>
      </TooltipPrimitive.Root>
    </TooltipProvider>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
