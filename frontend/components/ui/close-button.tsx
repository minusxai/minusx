import { IconButton, type IconButtonProps } from "@chakra-ui/react"
import { forwardRef } from "react"
import { LuX } from "react-icons/lu"

export const CloseButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function CloseButton(props, ref) {
    return (
      <IconButton variant="ghost" aria-label="Close" ref={ref} {...props}>
        <LuX />
      </IconButton>
    )
  },
)
