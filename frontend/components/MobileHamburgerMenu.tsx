'use client';

import { Box, Flex, HStack, Icon, Text, VStack, IconButton } from '@chakra-ui/react';
import { LuLogOut, LuSettings } from 'react-icons/lu';
import { signOut } from 'next-auth/react';
import { useNavigationGuard } from '@/lib/navigation/NavigationGuardProvider';
import ImpersonationSelector from './ImpersonationSelector';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser, selectCompanyName } from '@/store/authSlice';
import { APP_VERSION } from '@/lib/constants';
import { isAdmin } from '@/lib/auth/role-helpers';
import { useConfigs } from '@/lib/hooks/useConfigs';

interface MobileHamburgerMenuProps {
  onClose: () => void;
}

export default function MobileHamburgerMenu({ onClose }: MobileHamburgerMenuProps) {
  const { navigate } = useNavigationGuard();
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const companyName = useAppSelector(selectCompanyName);
  const colorMode = useAppSelector((state) => state.ui.colorMode);

  const { config } = useConfigs();
  const displayName = config.branding.agentName;

  return (
    <Box p={4} pb={8}>
      {/* Header with Logo */}
      <Flex justify="center" align="center" mb={6} mt={2}>
        <HStack gap={3}>
          <Box
            aria-label="Company logo"
            role="img"
            width={8}
            height={8}
            flexShrink={0}
          />
          <Text
            fontSize="xl"
            fontWeight="900"
            letterSpacing="-0.02em"
            color="fg.default"
            fontFamily="body"
          >
            {displayName}
          </Text>
        </HStack>
      </Flex>

      <VStack gap={0} align="stretch">
        {/* Impersonation Selector (Admin only) */}
        {effectiveUser?.role && isAdmin(effectiveUser.role) && (
          <Box
            px={4}
            py={4}
            borderBottom="1px solid"
            borderColor="border.default"
          >
            <ImpersonationSelector />
          </Box>
        )}

        {/* User Info */}
        <Box
          px={4}
          py={4}
          borderBottom="1px solid"
          borderColor="border.default"
        >
          <Text fontSize="sm" color="fg.subtle" fontFamily="mono" mb={1}>
            Signed in as
          </Text>
          <Text fontSize="md" color="fg.default" fontFamily="mono" fontWeight="600">
            {effectiveUser?.email || effectiveUser?.name}
          </Text>
        </Box>

        {/* Settings Button */}
        <Flex
          align="center"
          gap={3}
          px={4}
          py={4}
          justify="space-between"
          borderBottom="1px solid"
          borderColor="border.default"
          cursor="pointer"
          onClick={() => {
            navigate('/settings');
            onClose();
          }}
          _hover={{ bg: 'bg.muted' }}
          transition="background 0.2s"
        >
          <Text fontSize="sm" color="fg.default" fontFamily="mono">
            Settings
          </Text>
            <Icon as={LuSettings} boxSize={5} />
        </Flex>

        {/* Logout Button */}
        <Flex
          align="center"
          gap={3}
          px={4}
          py={4}
          justify="space-between"
          borderBottom="1px solid"
          borderColor="border.default"
          cursor="pointer"
          _hover={{ bg: 'bg.muted' }}
          transition="background 0.2s"
          onClick={() => {
            const redirectUrl = `${window.location.origin}/login`;
            signOut({ callbackUrl: redirectUrl, redirect:false, redirectTo: redirectUrl }).then(() => {
              window.location.href = redirectUrl; // Ensure redirect after sign out
            });
            onClose();
          }}
        >
          <Text fontSize="sm" color="fg.default" fontFamily="mono">
            Logout
          </Text>
          <Icon as={LuLogOut} boxSize={5} color="accent.danger" />
        </Flex>

        {/* Version */}
        <Box px={4} py={4} textAlign="center">
          <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
            {displayName} v{APP_VERSION}
          </Text>
        </Box>
      </VStack>

    </Box>
  );
}
