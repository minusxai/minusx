'use client';

import { Box, Heading, Text, Button, VStack, HStack, Table, IconButton, Input, Dialog, Portal, Menu } from '@chakra-ui/react';
import { LuPlus, LuPencil, LuTrash2, LuCrown, LuSquarePen, LuEye, LuCheck, LuX, LuChevronDown } from 'react-icons/lu';
import { useState, useEffect } from 'react';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';
import { useRouter } from '@/lib/navigation/use-navigation';
import type { User } from '@/lib/types';
import { isAdmin } from '@/lib/auth/role-helpers';
import Breadcrumb from '@/components/Breadcrumb';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { API } from '@/lib/api/declarations';

// Helper to get icon based on role
const getRoleIcon = (role: string | undefined) => {
  if (role && isAdmin(role as 'admin' | 'editor' | 'viewer')) return <LuCrown size={16} />;
  if (role === 'editor') return <LuSquarePen size={16} />;
  return <LuEye size={16} />;
};

// Helper to get icon color based on role
const getRoleIconColor = (role: string | undefined) => {
  if (role && isAdmin(role as 'admin' | 'editor' | 'viewer')) return 'accent.teal';
  if (role === 'editor') return 'accent.blue';
  return 'fg.muted';
};

// Extend User with required id field for this page
type UserWithId = Required<Pick<User, 'id' | 'name' | 'email'>> & Pick<User, 'role' | 'home_folder'>;

interface Message {
  type: 'success' | 'error';
  text: string;
}

export default function UsersPage() {
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const router = useRouter();
  const { config } = useConfigs();
  const [users, setUsers] = useState<UserWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<Message | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithId | null>(null);

  // Check if WhatsApp webhook is configured from Redux
  const hasWhatsAppWebhook = config?.messaging?.webhooks?.some(
    webhook => webhook.type === 'whatsapp'
  ) ?? false;

  // Form state
  const [formData, setFormData] = useState({
    email: '',
    name: '',
    password: '',
    phone: '',
    twofa_whatsapp_enabled: false,
    role: 'viewer' as 'admin' | 'editor' | 'viewer',
    home_folder: '',
  });

  // Redirect non-admins
  useEffect(() => {
    if (effectiveUser && effectiveUser.role && !isAdmin(effectiveUser.role)) {
      router.push('/');
    }
  }, [effectiveUser, router]);

  // Fetch users
  const fetchUsers = async () => {
    try {
      setLoading(true);
      const data = await fetchWithCache('/api/users', {
        method: 'GET',
        cacheStrategy: API.users.list.cache,
      });

      if (data.success) {
        setUsers(data.data.users);
      } else {
        setMessage({ type: 'error', text: data.error?.message || 'Failed to fetch users' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to fetch users' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (effectiveUser?.role && isAdmin(effectiveUser.role)) {
      fetchUsers();
    }
  }, [effectiveUser]);

  const handleAddUser = async () => {
    try {
      // Prepare request data with state as JSON string
      const requestData = {
        email: formData.email,
        name: formData.name,
        password: formData.password,
        phone: formData.phone || undefined,
        state: formData.phone ? JSON.stringify({ twofa_whatsapp_enabled: formData.twofa_whatsapp_enabled }) : undefined,
        role: formData.role,
        home_folder: formData.home_folder,
      };

      const data = await fetchWithCache('/api/users', {
        method: 'POST',
        body: JSON.stringify(requestData),
        cacheStrategy: API.users.create.cache,
      });

      if (data.success) {
        setMessage({ type: 'success', text: `${formData.name} has been added successfully` });
        setIsAddModalOpen(false);
        setFormData({ email: '', name: '', password: '', phone: '', twofa_whatsapp_enabled: false, role: 'viewer', home_folder: '' });
        fetchUsers();
      } else {
        setMessage({ type: 'error', text: data.error?.message || 'Failed to create user' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to create user' });
    }
  };

  const handleEditUser = async () => {
    if (!selectedUser) return;

    try {
      const updateData: any = {
        email: formData.email,
        name: formData.name,
        role: formData.role,
        home_folder: formData.home_folder,
        phone: formData.phone || undefined,
        state: JSON.stringify({ twofa_whatsapp_enabled: formData.twofa_whatsapp_enabled }),
      };

      // Only include password if it's been changed
      if (formData.password) {
        updateData.password = formData.password;
      }

      const data = await fetchWithCache(`/api/users/${selectedUser.id}`, {
        method: 'PUT',
        body: JSON.stringify(updateData),
        cacheStrategy: API.users.update.cache,
      });

      if (data.success) {
        setMessage({ type: 'success', text: `${formData.name} has been updated successfully` });
        setIsEditModalOpen(false);
        setSelectedUser(null);
        setFormData({ email: '', name: '', password: '', phone: '', twofa_whatsapp_enabled: false, role: 'viewer', home_folder: '' });
        fetchUsers();
      } else {
        setMessage({ type: 'error', text: data.error?.message || 'Failed to update user' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to update user' });
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;

    try {
      const data = await fetchWithCache(`/api/users/${selectedUser.id}`, {
        method: 'DELETE',
        cacheStrategy: API.users.delete.cache,
      });

      if (data.success) {
        setMessage({ type: 'success', text: `${selectedUser.name} has been deleted successfully` });
        setIsDeleteModalOpen(false);
        setSelectedUser(null);
        fetchUsers();
      } else {
        setMessage({ type: 'error', text: data.error?.message || 'Failed to delete user' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to delete user' });
    }
  };

  const openEditModal = (user: UserWithId) => {
    setSelectedUser(user);

    // Parse user state to check 2FA status
    let twofa_enabled = false;
    const userAny = user as any;

    console.log('[Users] Opening edit modal for user:', user);
    console.log('[Users] User phone:', userAny.phone);
    console.log('[Users] User state:', userAny.state);

    if (userAny.state) {
      try {
        const state = JSON.parse(userAny.state);
        twofa_enabled = state.twofa_whatsapp_enabled === true;
        console.log('[Users] Parsed state:', state);
        console.log('[Users] 2FA enabled:', twofa_enabled);
      } catch (e) {
        console.error('[Users] Failed to parse state:', e);
      }
    }

    const formDataToSet = {
      email: user.email,
      name: user.name,
      password: '',
      phone: (userAny.phone as string) || '',
      twofa_whatsapp_enabled: twofa_enabled,
      role: user.role || 'viewer',
      home_folder: user.home_folder || '',
    };

    console.log('[Users] Setting form data:', formDataToSet);
    console.log('[Users] Has WhatsApp webhook:', hasWhatsAppWebhook);
    console.log('[Users] Should show toggle:', (formDataToSet.phone && hasWhatsAppWebhook) || formDataToSet.twofa_whatsapp_enabled);

    setFormData(formDataToSet);
    setIsEditModalOpen(true);
  };

  const openDeleteModal = (user: UserWithId) => {
    setSelectedUser(user);
    setIsDeleteModalOpen(true);
  };

  if (!effectiveUser?.role || !isAdmin(effectiveUser.role)) {
    return null;
  }

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: 'Users' }
  ];

  return (
    <>
      <Box minH="90vh" bg="bg.canvas">
        <Box w="100%" mx="auto" px={{ base: 4, md: 8, lg: 12 }} pt={{ base: 3, md: 4, lg: 5 }} pb={{ base: 6, md: 8, lg: 10 }}>
          <Breadcrumb items={breadcrumbItems} />

          {/* Message Banner */}
          {message && (
            <Box
              mb={6}
              p={4}
              borderRadius="lg"
              bg={message.type === 'success' ? 'accent.success/10' : 'accent.danger/10'}
              borderWidth="1px"
              borderColor={message.type === 'success' ? 'accent.success' : 'accent.danger'}
            >
              <HStack gap={2}>
                <Box color={message.type === 'success' ? 'accent.success' : 'accent.danger'}>
                  {message.type === 'success' ? <LuCheck /> : <LuX />}
                </Box>
                <Text color={message.type === 'success' ? 'accent.success' : 'accent.danger'}>
                  {message.text}
                </Text>
              </HStack>
            </Box>
          )}

          {/* Header */}
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

          <HStack justify="space-between" mb={6} mt={4}>
            <Text fontSize="lg" color="fg.muted" fontFamily="mono">
              {users.length} {users.length === 1 ? 'user' : 'users'}
            </Text>
            <Button
              onClick={() => {
                setFormData({ email: '', name: '', password: '', phone: '', twofa_whatsapp_enabled: false, role: 'viewer', home_folder: '' });
                setIsAddModalOpen(true);
              }}
              bg="accent.teal"
              color="white"
              size="sm"
              _hover={{ transform: 'translateY(-1px)', shadow: 'md' }}
            >
              <LuPlus />
              Add User
            </Button>
          </HStack>

          {/* Users Table */}
          {loading ? (
            <Text color="fg.muted">Loading...</Text>
          ) : users.length === 0 ? (
            <Box
              p={12}
              textAlign="center"
              borderRadius="lg"
              border="2px dashed"
              borderColor="border.default"
            >
              <Text fontSize="lg" color="fg.muted" mb={2}>
                No users yet
              </Text>
              <Text fontSize="sm" color="fg.muted">
                Add your first user to get started
              </Text>
            </Box>
          ) : (
            <Box
              bg="bg.surface"
              borderRadius="lg"
              border="1px solid"
              borderColor="border.default"
              overflow="hidden"
            >
              <Table.Root size="lg">
                <Table.Header>
                  <Table.Row bg="bg.muted">
                    <Table.ColumnHeader fontFamily="mono" fontWeight="600">Name</Table.ColumnHeader>
                    <Table.ColumnHeader fontFamily="mono" fontWeight="600">Email</Table.ColumnHeader>
                    <Table.ColumnHeader fontFamily="mono" fontWeight="600">Role</Table.ColumnHeader>
                    <Table.ColumnHeader fontFamily="mono" fontWeight="600">Home Folder</Table.ColumnHeader>
                    <Table.ColumnHeader fontFamily="mono" fontWeight="600" textAlign="right">
                      Actions
                    </Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {users.map((user) => (
                    <Table.Row key={user.id} _hover={{ bg: 'bg.muted' }}>
                      <Table.Cell>
                        <HStack gap={2}>
                          <Box color={getRoleIconColor(user.role)}>
                            {getRoleIcon(user.role)}
                          </Box>
                          <Text fontFamily="body" fontWeight="500">{user.name}</Text>
                        </HStack>
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontFamily="mono" fontSize="sm" color="fg.muted">{user.email}</Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Box
                          display="inline-block"
                          px={2}
                          py={1}
                          borderRadius="md"
                          bg={isAdmin(user.role) ? 'accent.teal/10' : user.role === 'editor' ? 'accent.blue/10' : 'bg.muted'}
                          borderWidth="1px"
                          borderColor={isAdmin(user.role) ? 'accent.teal' : user.role === 'editor' ? 'accent.blue' : 'border.default'}
                        >
                          <Text
                            fontSize="xs"
                            fontFamily="mono"
                            fontWeight="600"
                            color={isAdmin(user.role) ? 'accent.teal' : user.role === 'editor' ? 'accent.blue' : 'fg.muted'}
                          >
                            {user.role.toUpperCase()}
                          </Text>
                        </Box>
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontFamily="mono" fontSize="sm" color="fg.muted">
                          {user.home_folder || '—'}
                        </Text>
                      </Table.Cell>
                      <Table.Cell textAlign="right">
                        <HStack gap={1} justify="flex-end">
                          <IconButton
                            onClick={() => openEditModal(user)}
                            variant="ghost"
                            size="xs"
                            aria-label="Edit user"
                          >
                            <LuPencil />
                          </IconButton>
                          <IconButton
                            onClick={() => openDeleteModal(user)}
                            variant="ghost"
                            size="xs"
                            aria-label="Delete user"
                            disabled={user.id === effectiveUser?.id}
                          >
                            <LuTrash2 />
                          </IconButton>
                        </HStack>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Box>
          )}
        </Box>
      </Box>

      {/* Add User Modal */}
      <Dialog.Root open={isAddModalOpen} onOpenChange={(e: { open: boolean }) => setIsAddModalOpen(e.open)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content
              maxW="500px"
              bg="bg.surface"
              borderRadius="lg"
              border="1px solid"
              borderColor="border.default"
            >
              <Dialog.Header
                px={6}
                py={4}
                borderBottom="1px solid"
                borderColor="border.default"
              >
                <Dialog.Title fontWeight="700" fontSize="xl">Add New User</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body px={6} py={5}>
              <VStack gap={4} align="stretch">
                <Box>
                  <Text fontSize="sm" fontWeight="600" mb={2}>Name</Text>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="John Doe"
                    size="lg"
                  />
                </Box>
                <Box>
                  <Text fontSize="sm" fontWeight="600" mb={2}>Email</Text>
                  <Input
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="john@example.com"
                    type="email"
                    size="lg"
                  />
                </Box>
                <Box>
                  <Text fontSize="sm" fontWeight="600" mb={2}>Password (optional)</Text>
                  <Input
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="Leave blank for passwordless auth"
                    type="password"
                    size="lg"
                  />
                </Box>
                <Box>
                  <Text fontSize="sm" fontWeight="600" mb={2}>Phone Number (optional)</Text>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+1234567890"
                    type="tel"
                    size="lg"
                  />
                </Box>
                {((formData.phone && hasWhatsAppWebhook) || formData.twofa_whatsapp_enabled) && (
                  <Box>
                    <HStack gap={2}>
                      <input
                        type="checkbox"
                        checked={formData.twofa_whatsapp_enabled}
                        onChange={(e) => setFormData({ ...formData, twofa_whatsapp_enabled: e.target.checked })}
                        disabled={!formData.phone || !hasWhatsAppWebhook}
                      />
                      <Text fontSize="sm" fontWeight="600">Enable WhatsApp 2FA</Text>
                    </HStack>
                    <Text fontSize="xs" color="fg.muted" mt={1}>
                      {!formData.phone
                        ? 'Enter phone number to enable 2FA'
                        : !hasWhatsAppWebhook
                        ? 'Configure WhatsApp webhook in company config to enable 2FA'
                        : 'Requires phone number and messaging configuration'
                      }
                    </Text>
                  </Box>
                )}
                <Box>
                  <Text fontSize="sm" fontWeight="600" mb={2}>Home Folder (optional)</Text>
                  <Input
                    value={formData.home_folder}
                    onChange={(e) => setFormData({ ...formData, home_folder: e.target.value })}
                    placeholder="sales/team (relative path, blank for mode root)"
                    size="lg"
                  />
                </Box>
                <Box>
                  <Text fontSize="sm" fontWeight="600" mb={2}>Role</Text>
                  <Menu.Root>
                    <Menu.Trigger asChild>
                      <Button
                        variant="outline"
                        size="lg"
                        w="100%"
                        justifyContent="space-between"
                        fontWeight="400"
                      >
                        <HStack gap={2}>
                          <Box color={getRoleIconColor(formData.role)}>
                            {getRoleIcon(formData.role)}
                          </Box>
                          <Text>{formData.role.charAt(0).toUpperCase() + formData.role.slice(1)}</Text>
                        </HStack>
                        <LuChevronDown />
                      </Button>
                    </Menu.Trigger>
                    <Menu.Positioner>
                        <Menu.Content minW="200px" bg="bg.surface" borderColor="border.default" shadow="lg">
                          <Menu.Item value="viewer" onClick={() => setFormData({ ...formData, role: 'viewer' })}>
                            <HStack gap={2}>
                              <Box color="fg.muted"><LuEye size={16} /></Box>
                              <Text>Viewer</Text>
                            </HStack>
                          </Menu.Item>
                          <Menu.Item value="editor" onClick={() => setFormData({ ...formData, role: 'editor' })}>
                            <HStack gap={2}>
                              <Box color="accent.blue"><LuSquarePen size={16} /></Box>
                              <Text>Editor</Text>
                            </HStack>
                          </Menu.Item>
                          <Menu.Item value="admin" onClick={() => setFormData({ ...formData, role: 'admin' })}>
                            <HStack gap={2}>
                              <Box color="accent.teal"><LuCrown size={16} /></Box>
                              <Text>Admin</Text>
                            </HStack>
                          </Menu.Item>
                        </Menu.Content>
                      </Menu.Positioner>
                  </Menu.Root>
                </Box>
              </VStack>
              </Dialog.Body>
              <Dialog.Footer
                px={6}
                py={4}
                gap={3}
                borderTop="1px solid"
                borderColor="border.default"
                justifyContent="flex-end"
              >
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.ActionTrigger>
                <Button onClick={handleAddUser} bg="accent.teal" color="white">
                  Add User
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger />
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* Edit User Modal */}
      <Dialog.Root open={isEditModalOpen} onOpenChange={(e: { open: boolean }) => setIsEditModalOpen(e.open)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content
              maxW="500px"
              bg="bg.surface"
              borderRadius="lg"
              border="1px solid"
              borderColor="border.default"
            >
              <Dialog.Header
                px={6}
                py={4}
                borderBottom="1px solid"
                borderColor="border.default"
              >
                <Dialog.Title fontWeight="700" fontSize="xl">Edit User</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body px={6} py={5}>
              <VStack gap={4} align="stretch">
                <Box>
                  <Text fontSize="sm" fontWeight="600" mb={2}>Name</Text>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    size="lg"
                  />
                </Box>
                <Box>
                  <Text fontSize="sm" fontWeight="600" mb={2}>Email</Text>
                  <Input
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    type="email"
                    size="lg"
                  />
                </Box>
                <Box>
                  <Text fontSize="sm" fontWeight="600" mb={2}>New Password (leave blank to keep current)</Text>
                  <Input
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="Enter new password"
                    type="password"
                    size="lg"
                  />
                </Box>
                <Box>
                  <Text fontSize="sm" fontWeight="600" mb={2}>Phone Number (optional)</Text>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+1234567890"
                    type="tel"
                    size="lg"
                  />
                </Box>
                {((formData.phone && hasWhatsAppWebhook) || formData.twofa_whatsapp_enabled) && (
                  <Box>
                    <HStack gap={2}>
                      <input
                        type="checkbox"
                        checked={formData.twofa_whatsapp_enabled}
                        onChange={(e) => setFormData({ ...formData, twofa_whatsapp_enabled: e.target.checked })}
                        disabled={!formData.phone || !hasWhatsAppWebhook}
                      />
                      <Text fontSize="sm" fontWeight="600">Enable WhatsApp 2FA</Text>
                    </HStack>
                    <Text fontSize="xs" color="fg.muted" mt={1}>
                      {!formData.phone
                        ? 'Enter phone number to enable 2FA'
                        : !hasWhatsAppWebhook
                        ? 'Configure WhatsApp webhook in company config to enable 2FA'
                        : 'Requires phone number and messaging configuration'
                      }
                    </Text>
                  </Box>
                )}
                <Box>
                  <Text fontSize="sm" fontWeight="600" mb={2}>Home Folder</Text>
                  <Input
                    value={formData.home_folder}
                    onChange={(e) => setFormData({ ...formData, home_folder: e.target.value })}
                    placeholder="sales/team (relative path, blank for mode root)"
                    size="lg"
                  />
                </Box>
                <Box>
                  <Text fontSize="sm" fontWeight="600" mb={2}>Role</Text>
                  <Menu.Root>
                    <Menu.Trigger asChild>
                      <Button
                        variant="outline"
                        size="lg"
                        w="100%"
                        justifyContent="space-between"
                        fontWeight="400"
                      >
                        <HStack gap={2}>
                          <Box color={getRoleIconColor(formData.role)}>
                            {getRoleIcon(formData.role)}
                          </Box>
                          <Text>{formData.role.charAt(0).toUpperCase() + formData.role.slice(1)}</Text>
                        </HStack>
                        <LuChevronDown />
                      </Button>
                    </Menu.Trigger>
                    <Menu.Positioner>
                        <Menu.Content minW="200px" bg="bg.surface" borderColor="border.default" shadow="lg">
                          <Menu.Item value="viewer" onClick={() => setFormData({ ...formData, role: 'viewer' })}>
                            <HStack gap={2}>
                              <Box color="fg.muted"><LuEye size={16} /></Box>
                              <Text>Viewer</Text>
                            </HStack>
                          </Menu.Item>
                          <Menu.Item value="editor" onClick={() => setFormData({ ...formData, role: 'editor' })}>
                            <HStack gap={2}>
                              <Box color="accent.blue"><LuSquarePen size={16} /></Box>
                              <Text>Editor</Text>
                            </HStack>
                          </Menu.Item>
                          <Menu.Item value="admin" onClick={() => setFormData({ ...formData, role: 'admin' })}>
                            <HStack gap={2}>
                              <Box color="accent.teal"><LuCrown size={16} /></Box>
                              <Text>Admin</Text>
                            </HStack>
                          </Menu.Item>
                        </Menu.Content>
                      </Menu.Positioner>
                  </Menu.Root>
                </Box>
              </VStack>
              </Dialog.Body>
              <Dialog.Footer
                px={6}
                py={4}
                gap={3}
                borderTop="1px solid"
                borderColor="border.default"
                justifyContent="flex-end"
              >
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.ActionTrigger>
                <Button onClick={handleEditUser} bg="accent.teal" color="white">
                  Save Changes
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger />
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* Delete User Modal */}
      <Dialog.Root open={isDeleteModalOpen} onOpenChange={(e: { open: boolean }) => setIsDeleteModalOpen(e.open)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content
              maxW="500px"
              bg="bg.surface"
              borderRadius="lg"
              border="1px solid"
              borderColor="border.default"
            >
              <Dialog.Header
                px={6}
                py={4}
                borderBottom="1px solid"
                borderColor="border.default"
              >
                <Dialog.Title fontWeight="700" fontSize="xl">Delete User</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body px={6} py={5}>
                <Text fontSize="sm" lineHeight="1.6">
                  Are you sure you want to delete <Text as="span" fontWeight="600" fontFamily="mono">"{selectedUser?.name}"</Text>? This action cannot be undone.
                </Text>
              </Dialog.Body>
              <Dialog.Footer
                px={6}
                py={4}
                gap={3}
                borderTop="1px solid"
                borderColor="border.default"
                justifyContent="flex-end"
              >
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.ActionTrigger>
                <Button onClick={handleDeleteUser} bg="accent.danger" color="white">
                  Delete User
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger />
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </>
  );
}
