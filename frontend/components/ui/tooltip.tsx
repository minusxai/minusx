"use client"

import { Tooltip as ChakraTooltip, Portal } from "@chakra-ui/react"
import * as React from "react"
import { useDeepStable } from "@/lib/hooks/use-deep-stable"

export interface TooltipProps extends ChakraTooltip.RootProps {
  showArrow?: boolean
  portalled?: boolean
  content: React.ReactNode
  contentProps?: ChakraTooltip.ContentProps
  portalRef?: React.RefObject<HTMLElement>
}

export const Tooltip = React.forwardRef<HTMLDivElement, TooltipProps>(
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
    // source of Tooltip "Consider memoization" warnings in the perf trace
    // (226 wasted renders). Stabilising the reference here means we don't
    // need a useMemo at each call site.
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
Tooltip.displayName = 'Tooltip'
