'use client';

import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { LuUserCog } from 'react-icons/lu';
import GenericSelector, { type SelectorOption } from './GenericSelector';
import { selectEffectiveUser } from '@/store/authSlice';
import { startImpersonation } from '@/lib/navigation/url-utils';
import { isAdmin } from '@/lib/auth/role-helpers';
import { useUsers } from '@/lib/hooks/useUsers';
import { useAppSelector } from '@/store/hooks';
import { selectDevMode } from '@/store/uiSlice';

export default function ImpersonationSelector() {
  const currentUser = useSelector(selectEffectiveUser);
  const isUserAdmin = currentUser?.role ? isAdmin(currentUser.role) : false;
  const devMode = useAppSelector(selectDevMode);

  const { users: allUsers, loading: usersLoading } = useUsers();

  const users = useMemo(() => {
    return allUsers
      .filter(u => u.email !== currentUser?.email) // Don't show self
      .map(u => ({
        value: u.email,
        label: u.name,
        subtitle: u.role === 'admin' ? 'Admin' : u.email,
        icon: LuUserCog,
      }));
  }, [allUsers, currentUser?.email]);

  if (!isUserAdmin || !devMode) {
    return null;
  }

  return (
    <GenericSelector
      value=""
      onChange={startImpersonation}
      options={users}
      loading={usersLoading}
      placeholder="Impersonate user..."
      emptyMessage="No users available"
      defaultIcon={LuUserCog}
      size="sm"
      color="border.default"
    />
  );
}
