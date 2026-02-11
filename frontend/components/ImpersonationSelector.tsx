'use client';

import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { LuUserCog } from 'react-icons/lu';
import GenericSelector, { type SelectorOption } from './GenericSelector';
import { selectEffectiveUser } from '@/store/authSlice';
import { startImpersonation } from '@/lib/navigation/url-utils';
import { isAdmin } from '@/lib/auth/role-helpers';
import { useFetch } from '@/lib/api/useFetch';
import { API } from '@/lib/api/declarations';

export default function ImpersonationSelector() {
  const currentUser = useSelector(selectEffectiveUser);
  const isUserAdmin = currentUser?.role ? isAdmin(currentUser.role) : false;

  // Memoize options to prevent recreating object on every render
  const fetchOptions = useMemo(() => ({
    enabled: isUserAdmin,
  }), [isUserAdmin]);

  // Fetch users list only if user is admin (enabled parameter)
  const { data, loading } = useFetch(API.users.list, undefined, fetchOptions);

  // Transform users data into selector options
  const users = useMemo(() => {
    const usersList = (data as any)?.data?.users || (data as any)?.users || [];
    return usersList
      .filter((u: any) => u.email !== currentUser?.email) // Don't show self
      .map((u: any) => ({
        value: u.email,
        label: u.name,
        subtitle: u.role === 'admin' ? 'Admin' : u.email,
        icon: LuUserCog,
      }));
  }, [data, currentUser?.email]);

  // Only show for admins
  if (!isUserAdmin) {
    return null;
  }

  return (
    <GenericSelector
      value=""
      onChange={startImpersonation}
      options={users}
      loading={loading}
      placeholder="Impersonate user..."
      emptyMessage="No users available"
      defaultIcon={LuUserCog}
      size="sm"
      color="border.default"
    />
  );
}
