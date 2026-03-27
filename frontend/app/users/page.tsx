'use client';

import { Box, Heading } from '@chakra-ui/react';
import { useEffect } from 'react';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';
import { useRouter } from '@/lib/navigation/use-navigation';
import { isAdmin } from '@/lib/auth/role-helpers';
import Breadcrumb from '@/components/Breadcrumb';
import UsersContent from '@/components/UsersContent';

export default function UsersPage() {
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const router = useRouter();

  // Redirect non-admins
  useEffect(() => {
    if (effectiveUser && effectiveUser.role && !isAdmin(effectiveUser.role)) {
      router.push('/');
    }
  }, [effectiveUser, router]);

  if (!effectiveUser?.role || !isAdmin(effectiveUser.role)) {
    return null;
  }

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: 'Users' }
  ];

  return (
    <Box minH="90vh" bg="bg.canvas">
      <Box w="100%" mx="auto" px={{ base: 4, md: 8, lg: 12 }} pt={{ base: 3, md: 4, lg: 5 }} pb={{ base: 6, md: 8, lg: 10 }}>
        <Breadcrumb items={breadcrumbItems} />

        <Heading
          fontSize={{ base: '3xl', md: '4xl', lg: '5xl' }}
          fontWeight="900"
          letterSpacing="-0.03em"
          mt={10}
          mb={2}
          color="fg.default"
        >
          Users
        </Heading>

        <Box mt={4}>
          <UsersContent />
        </Box>
      </Box>
    </Box>
  );
}
