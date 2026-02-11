"use client"

import { ClientOnly, Skeleton, Switch } from "@chakra-ui/react"
import { useAppSelector, useAppDispatch } from '@/store/hooks'
import { setColorMode as setColorModeAction } from '@/store/uiSlice'

interface ColorModeSwitchProps {
  [key: string]: any
}

/**
 * Color mode toggle switch
 * Note: Color mode sync with localStorage is handled by ColorModeSync component at app root
 */
export const ColorModeSwitch = function ColorModeSwitch(props: ColorModeSwitchProps) {
  const dispatch = useAppDispatch()
  const colorMode = useAppSelector((state) => state.ui.colorMode)

  return (
    <ClientOnly fallback={<Skeleton boxSize="8" />}>
      <Switch.Root
        checked={colorMode === 'dark'}
        onCheckedChange={(details) => dispatch(setColorModeAction(details.checked ? 'dark' : 'light'))}
        colorPalette="teal"
        {...props}
      >
        <Switch.HiddenInput />
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Root>
    </ClientOnly>
  )
}

// Deprecated: Use ColorModeSwitch instead
export const ColorModeButton = ColorModeSwitch
