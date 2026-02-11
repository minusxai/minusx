'use client';

import { Box, Flex, Icon, Text, Dialog } from '@chakra-ui/react';
import { LuHouse, LuRocket, LuPlus, LuDatabase, LuMenu } from 'react-icons/lu';
import { Link } from '@/components/ui/Link';
import { usePathname } from 'next/navigation';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';
import { useState } from 'react';
import MobileHamburgerMenu from './MobileHamburgerMenu';
import MobileNewFileSheet from './MobileNewFileSheet';
import { isAdmin } from '@/lib/auth/role-helpers';

interface NavIconProps {
  href?: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  onClick?: () => void;
}

function NavIcon({ href, icon, label, isActive, onClick }: NavIconProps) {
  const content = (
    <Flex
      direction="column"
      align="center"
      justify="center"
      gap={0.5}
      cursor="pointer"
      color={isActive ? 'accent.teal' : 'fg.muted'}
      _hover={{ color: 'accent.teal' }}
      transition="all 0.2s"
      flex={1}
      py={2}
      onClick={onClick}
      position="relative"
    >
      <Icon as={icon} boxSize={5} />
      <Text fontSize="2xs" fontWeight={isActive ? '600' : '400'} fontFamily="mono">
        {label}
      </Text>
    </Flex>
  );

  return href ? (
    <Link href={href} style={{ flex: 1, textDecoration: 'none' }}>
      {content}
    </Link>
  ) : (
    content
  );
}

export default function MobileBottomNav() {
  const pathname = usePathname();
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isNewFileOpen, setIsNewFileOpen] = useState(false);

  // Show plus button only on folder paths (/, /p/...) not on file pages (/f/...)
//   const showPlusButton = pathname === '/' || pathname.startsWith('/p/');

  // Get user mode for mode-aware navigation
  const mode = effectiveUser?.mode || 'org';

  const navItems = [
    { href: '/', icon: LuHouse, label: 'Home' },
    { href: '/explore', icon: LuRocket, label: 'Explore' },
    { icon: LuPlus, label: 'Create', isNew: true },
    ...(effectiveUser?.role && isAdmin(effectiveUser.role) ? [{ href: `/p/${mode}/database`, icon: LuDatabase, label: 'DB' }] : []),
    { icon: LuMenu, label: 'Menu' },
  ];

  return (
    <>
      {/* Bottom Navigation Bar */}
      <Box
        position="fixed"
        bottom={0}
        left={0}
        right={0}
        h="64px"
        bg="bg.surface"
        borderTop="1px solid"
        borderColor="border.default"
        zIndex={100}
        display={{ base: 'block', md: 'none' }} // Only show on mobile
      >
        <Flex h="full" align="center" justify="space-around" px={2}>
          {navItems.map((item) => (
            <NavIcon
              key={item.label}
              href={item.href}
              icon={item.icon}
              label={item.label}
              isActive={item.href ? pathname === item.href : false}
              onClick={
                item.label === 'Menu'
                  ? () => setIsMenuOpen(true)
                  : item.label === 'Create'
                  ? () => setIsNewFileOpen(true)
                  : undefined
              }
            />
          ))}
        </Flex>
      </Box>

      {/* Floating Action Button (FAB) for New */}
      {/* Temporarily disabled to show bottom bar version */}
      {/* {showPlusButton && (
        <Box
          position="fixed"
          top="16px"
          right="16px"
          display={{ base: 'block', md: 'none' }} // Only show on mobile
          zIndex={101}
        >
          <Flex
            bg="accent.teal"
            borderRadius="full"
            boxSize="48px"
            align="center"
            justify="center"
            shadow="lg"
            cursor="pointer"
            color="white"
            _hover={{ transform: 'scale(1.05)' }}
            _active={{ transform: 'scale(0.95)' }}
            transition="transform 0.2s"
            onClick={() => setIsNewFileOpen(true)}
          >
            <Icon as={LuPlus} boxSize={7} />
          </Flex>
        </Box>
      )} */}

      {/* Hamburger Menu Dialog */}
      <Dialog.Root
        open={isMenuOpen}
        onOpenChange={(e) => setIsMenuOpen(e.open)}
        placement="bottom"
      >
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content maxH="80vh" borderTopRadius="xl" borderBottomRadius="0">
            <Dialog.CloseTrigger />
            <MobileHamburgerMenu onClose={() => setIsMenuOpen(false)} />
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* New File Bottom Sheet */}
      <Dialog.Root
        open={isNewFileOpen}
        onOpenChange={(e) => setIsNewFileOpen(e.open)}
        placement="bottom"
      >
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content maxH="70vh" borderTopRadius="xl" borderBottomRadius="0">
            <Dialog.CloseTrigger />
            <MobileNewFileSheet onClose={() => setIsNewFileOpen(false)} />
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </>
  );
}
