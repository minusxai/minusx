"use client"

import { Tooltip as ChakraTooltip, Portal } from "@chakra-ui/react"
import * as React from "react"
import isEqual from "lodash/isEqual"
import { useDeepStable } from "@/lib/hooks/use-deep-stable"
import { shallowEqualExcept } from "@/lib/hooks/use-stable-callback"

export interface TooltipProps extends ChakraTooltip.RootProps {
  showArrow?: boolean
  portalled?: boolean
  content: React.ReactNode
  contentProps?: ChakraTooltip.ContentProps
  portalRef?: React.RefObject<HTMLElement>
}

const TooltipInner = React.forwardRef<HTMLDivElement, TooltipProps>(
  function Tooltip(props, ref) {
    const {
      showArrow,
      children,
      disabled,
      portalled = true,
      content,
      contentProps,
      portalRef,
      positioning,
      ...rest
    } = props

    // Almost every caller passes a brand-new inline literal
    // (`positioning={{ placement: 'top' }}`), which was the single biggest
    // source of Tooltip "Consider memoization" warnings in the perf trace.
    // Stabilising the reference here means we don't need a useMemo at each
    // call site, and the downstream `<ChakraTooltip.Root>` sees a stable ref.
    const stablePositioning = useDeepStable(positioning)

    if (disabled) return children

    return (
      <ChakraTooltip.Root {...rest} positioning={stablePositioning}>
        <ChakraTooltip.Trigger asChild>{children}</ChakraTooltip.Trigger>
        <Portal disabled={!portalled} container={portalRef}>
          <ChakraTooltip.Positioner>
            <ChakraTooltip.Content ref={ref} px={3} py={2} {...contentProps}>
              {showArrow && (
                <ChakraTooltip.Arrow>
                  <ChakraTooltip.ArrowTip />
                </ChakraTooltip.Arrow>
              )}
              {content}
            </ChakraTooltip.Content>
          </ChakraTooltip.Positioner>
        </Portal>
      </ChakraTooltip.Root>
    )
  }
)
TooltipInner.displayName = 'Tooltip'

/**
 * memo comparator: deep-equal `positioning` (callers consistently pass inline
 * `positioning={{ placement: 'top' }}` literals — the trace's #1 Tooltip-prop
 * offender); shallow everything else. Even though `useDeepStable` inside the
 * wrapper protected the *downstream* Chakra Tooltip, the wrapper itself still
 * re-rendered, which React DevTools flagged.
 */
export const Tooltip = React.memo(TooltipInner, (prev, next) => {
  if (!isEqual(prev.positioning, next.positioning)) return false
  return shallowEqualExcept(prev, next, ['positioning'])
}) as typeof TooltipInner
Tooltip.displayName = 'Tooltip'
