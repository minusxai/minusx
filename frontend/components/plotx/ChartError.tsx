import { Box, Text, VStack } from '@chakra-ui/react'
import { LuTriangleAlert } from 'react-icons/lu'

interface ChartErrorProps {
  title?: string
  message: string
}

export const ChartError = ({ title = 'Chart configuration error', message }: ChartErrorProps) => {
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
        bg="orange.500/6"
        border="1px solid"
        borderColor="orange.500/20"
        borderRadius="xl"
        px={8}
        py={7}
        maxWidth="460px"
      >
        <VStack gap={3} textAlign="center">
          <Box
            bg="orange.500/12"
            borderRadius="full"
            p={3}
            color="orange.500"
            fontSize="xl"
          >
            <LuTriangleAlert />
          </Box>
          <Text fontSize="lg" fontWeight="700" fontFamily="mono" color="fg.default">
            {title}
          </Text>
          <Text fontSize="md" fontFamily="mono" color="fg.subtle" lineHeight="tall">
            {message}
          </Text>
        </VStack>
      </Box>
    </Box>
  )
}
