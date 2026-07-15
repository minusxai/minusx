'use client';

/**
 * Access explorer (Access V2) — the two explainability views:
 *  - Folder → who can see it (and who can build in it), via what.
 *  - User → why they have the access they have.
 * Backed by GET /api/access-report.
 */
import { useMemo, useState } from 'react';
import { Badge, Box, Button, HStack, Input, Text, VStack } from '@chakra-ui/react';
import SimpleSelect from '@/components/evals/SimpleSelect';
import { useUsers } from '@/lib/hooks/useUsers';

interface FolderEntry { kind: string; label: string; write: boolean; users: string[] }
interface UserEntry { source: string; label: string; detail: string }

export function AccessExplorer() {
  const { users } = useUsers();
  const roster = useMemo(() => users.filter((u): u is typeof u & { id: number } => typeof u.id === 'number'), [users]);
  const [folder, setFolder] = useState('');
  const [folderEntries, setFolderEntries] = useState<FolderEntry[] | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [userEntries, setUserEntries] = useState<UserEntry[] | null>(null);

  const checkFolder = async () => {
    const res = await fetch(`/api/access-report?path=${encodeURIComponent(folder || '/')}`, { credentials: 'include' });
    const body = await res.json().catch(() => null);
    setFolderEntries(body?.data?.entries ?? []);
  };

  const checkUser = async (id: string) => {
    setUserId(id);
    if (!id) { setUserEntries(null); return; }
    const res = await fetch(`/api/access-report?userId=${id}`, { credentials: 'include' });
    const body = await res.json().catch(() => null);
    setUserEntries(body?.data?.entries ?? []);
  };

  return (
    <VStack align="stretch" gap={4} aria-label="Access explorer">
      <Box>
        <Text fontSize="sm" fontWeight="semibold" fontFamily="mono" mb={1}>Access explorer</Text>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono">
          Answer &quot;who can see this folder?&quot; and &quot;why does this person have access?&quot;
        </Text>
      </Box>

      <Box>
        <Text fontSize="xs" fontWeight="600" mb={1}>Who can access a folder</Text>
        <HStack gap={2}>
          <Input aria-label="Access explorer folder" value={folder} onChange={e => setFolder(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); checkFolder(); } }}
            placeholder="finance" fontFamily="mono" size="sm" />
          <Button size="sm" variant="outline" aria-label="Check folder access" onClick={checkFolder}>Check</Button>
        </HStack>
        {folderEntries && (
          <VStack align="stretch" gap={1} mt={2} aria-label="Folder access results">
            {folderEntries.map((e, i) => (
              <HStack key={i} justify="space-between" px={2} py={1} borderWidth="1px" borderColor="border.default" borderRadius="sm">
                <Text fontSize="xs" fontFamily="mono">{e.label}{e.kind === 'group' ? ` — ${e.users.join(', ')}` : ''}</Text>
                <Badge size="sm" colorPalette={e.write ? 'blue' : 'gray'}>{e.write ? 'can build' : 'can view'}</Badge>
              </HStack>
            ))}
            {folderEntries.length === 0 && <Text fontSize="xs" color="fg.muted">No one has access.</Text>}
          </VStack>
        )}
      </Box>

      <Box>
        <Text fontSize="xs" fontWeight="600" mb={1}>Why does a user have access</Text>
        <SimpleSelect
          aria-label="Access explorer user"
          value={userId}
          onChange={checkUser}
          options={[{ value: '', label: 'Pick a user…' }, ...roster.map(u => ({ value: String(u.id), label: u.email }))]}
        />
        {userEntries && (
          <VStack align="stretch" gap={1} mt={2} aria-label="User access results">
            {userEntries.map((e, i) => (
              <Box key={i} px={2} py={1} borderWidth="1px" borderColor="border.default" borderRadius="sm">
                <Text fontSize="xs" fontWeight="600" fontFamily="mono">{e.label}</Text>
                <Text fontSize="xs" color="fg.muted" fontFamily="mono">{e.detail}</Text>
              </Box>
            ))}
          </VStack>
        )}
      </Box>
    </VStack>
  );
}
