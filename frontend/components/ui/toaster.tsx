"use client"

import { Toaster as ChakraToaster, Portal, Spinner, Stack, Toast, createToaster } from "@chakra-ui/react"
import { CloseButton } from "@/components/ui/close-button"

export const toaster = createToaster({
  placement: "top-end",
  pauseOnPageIdle: true,
})

export const Toaster = () => {
  return (
    <Portal>
      <ChakraToaster
        toaster={toaster}
        insetInline={{ mdDown: "4" }}
      >
        {(toast) => (
          <Toast.Root width={{ md: "sm" }}>
            {toast.type === "loading" ? (
              <Spinner size="sm" color="blue.solid" />
            ) : (
              <Toast.Indicator />
            )}
            <Stack gap="1" flex="1" maxWidth="100%">
              {toast.title && <Toast.Title>{toast.title}</Toast.Title>}
              {toast.description && (
                <Toast.Description>{toast.description}</Toast.Description>
              )}
            </Stack>
            {toast.action && (
              <Toast.ActionTrigger>{toast.action.label}</Toast.ActionTrigger>
            )}
            {toast.meta?.closable && (
              <CloseButton size="sm" asChild>
                <Toast.CloseTrigger />
              </CloseButton>
            )}
          </Toast.Root>
        )}
      </ChakraToaster>
    </Portal>
  )
}
