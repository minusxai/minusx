import { Box, Text, VStack } from '@chakra-ui/react'
import { LuTriangleAlert, LuInfo } from 'react-icons/lu'

interface ChartErrorProps {
  title?: string
  message: string
  variant?: 'warning' | 'info'
}

const VARIANT_STYLES = {
  warning: {
    color: 'orange.500',
    bg: 'orange.500/6',
    borderColor: 'orange.500/20',
    iconBg: 'orange.500/12',
    Icon: LuTriangleAlert,
  },
  info: {
    color: 'teal.500',
    bg: 'teal.500/6',
    borderColor: 'teal.500/20',
    iconBg: 'teal.500/12',
    Icon: LuInfo,
  },
} as const

export const ChartError = ({ title, message, variant = 'warning' }: ChartErrorProps) => {
  const style = VARIANT_STYLES[variant]
  const defaultTitle = variant === 'info' ? 'No data to display' : 'Chart configuration error'

  return (
    <Box
      display="flex"
      alignItems="center"
      justifyContent="center"
      width="100%"
      height="100%"
      minHeight="250px"
      p={8}
    >
      <Box
        bg={style.bg}
        border="1px solid"
        borderColor={style.borderColor}
        borderRadius="xl"
        px={8}
        py={7}
        maxWidth="460px"
      >
        <VStack gap={3} textAlign="center">
          <Box
            bg={style.iconBg}
            borderRadius="full"
            p={3}
            color={style.color}
            fontSize="xl"
          >
            <style.Icon />
          </Box>
          <Text fontSize="lg" fontWeight="700" fontFamily="mono" color="fg.default">
            {title || defaultTitle}
          </Text>
          <Text fontSize="md" fontFamily="mono" color="fg.subtle" lineHeight="tall">
            {message}
          </Text>
        </VStack>
      </Box>
    </Box>
  )
}
