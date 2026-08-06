'use client';

import { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react';
import {
  Box,
  Input,
  Icon,
  VStack,
  HStack,
  Text,
  Spinner,
  Portal
} from '@chakra-ui/react';
import { LuSearch, LuFile, LuTriangleAlert } from 'react-icons/lu';
import { useNavigationGuard } from '@/lib/navigation/NavigationGuardProvider';
import { FILE_TYPE_METADATA, getFileDisplayName, isFileUntitled } from '@/lib/ui/file-metadata';
import type { SearchResultMetadata } from '@/lib/search/file-search';
import { useFetchManual } from '@/lib/http/useFetch';
import { API } from '@/lib/http/declarations';

interface FileSearchBarProps {
  onResultClick?: (fileId: number) => void;
}

export default function FileSearchBar({ onResultClick }: FileSearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultMetadata[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  // `pending` covers the whole silent stretch — debounce AND request — that
  // `loading` misses: `loading` only flips once the debounce fires, so without
  // this the user's first search sat behind a blank screen for ~500ms.
  const [pending, setPending] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Bumped by every new search and by every dismissal. A response whose ticket
  // no longer matches is stale — it must neither overwrite newer results nor
  // reopen a dropdown the user has already closed.
  const requestSeq = useRef(0);
  const { navigate } = useNavigationGuard();

  // Use centralized fetch with automatic deduplication
  const [searchFiles, { loading }] = useFetchManual(API.files.search);

  // The dropdown opens on intent, not on arrival: `pending` is set on the
  // keystroke so the spinner is on screen before the request is even sent.
  const dropdownOpen = showDropdown || pending;

  const closeDropdown = useCallback(() => {
    setShowDropdown(false);
    setPending(false);
    requestSeq.current += 1; // any in-flight response is now unwanted
  }, []);

  // Debounced search effect
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setShowDropdown(false);
      setPending(false);
      setSearchError(false);
      return;
    }

    const ticket = ++requestSeq.current;

    const timeoutId = setTimeout(async () => {
      try {
        const data = await searchFiles({
          query: query.trim(),
          limit: 10 // Show top 10 results
        }) as any;
        if (requestSeq.current !== ticket) return;
        setResults(data.results || []);
        setSearchError(false);
        setShowDropdown(true);
        setSelectedIndex(0);
      } catch (error) {
        console.error('Search error:', error);
        if (requestSeq.current !== ticket) return;
        setResults([]);
        // Surface the failure instead of leaving the widget inert
        setSearchError(true);
        setShowDropdown(true);
      } finally {
        if (requestSeq.current === ticket) setPending(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query, searchFiles]);

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const clickedInside =
        (containerRef.current && containerRef.current.contains(target)) ||
        (dropdownRef.current && dropdownRef.current.contains(target));

      if (!clickedInside) {
        closeDropdown();
        setIsFocused(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closeDropdown]);

  const handleNavigate = (result: SearchResultMetadata) => {
    setQuery('');
    setResults([]);
    closeDropdown();
    setIsFocused(false);
    inputRef.current?.blur();

    if (onResultClick) {
      onResultClick(result.id);
    } else {
      // Navigate to folder path for folders, file detail for everything else
      if (result.type === 'folder') {
        navigate(`/p${result.path}`);
      } else {
        navigate(`/f/${result.id}`);
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Escape must also dismiss a search that is merely pending — otherwise the
    // response lands later and reopens a dropdown the user already closed.
    if (!dropdownOpen || results.length === 0) {
      if (e.key === 'Escape') {
        inputRef.current?.blur();
        closeDropdown();
        setIsFocused(false);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          handleNavigate(results[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        closeDropdown();
        setIsFocused(false);
        inputRef.current?.blur();
        break;
    }
  };

  return (
    <Box ref={containerRef} position="relative" width={{ base: '200px', md: isFocused ? '400px' : '300px' }} transition="width 0.2s ease">
      <HStack
        position="relative"
        bg="bg.subtle"
        border="1px solid"
        borderColor="border.default"
        borderRadius="md"
        h="32px"
        px={3}
        gap={2}
        _focusWithin={{
          borderColor: 'accent.teal',
          boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)'
        }}
        transition="all 0.2s"
      >
        <Icon as={LuSearch} color="fg.muted" boxSize={4} flexShrink={0} />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            // Batched into the same render as the query, so the spinner is on
            // screen from the keystroke itself — not one frame later.
            setPending(next.trim().length > 0);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setIsFocused(true);
            if (query.trim() && results.length > 0) {
              setShowDropdown(true);
            }
          }}
          aria-label="Search files"
          placeholder="Search files..."
          bg="transparent"
          border="none"
          fontSize="sm"
          fontFamily="mono"
          px={0}
          h="auto"
          _focus={{
            outline: 'none',
            boxShadow: 'none'
          }}
          _placeholder={{ color: 'fg.muted', fontFamily: 'mono' }}
        />
      </HStack>

      {/* Dropdown Results */}
      {dropdownOpen && (
        <Portal>
          {/* Accessing containerRef during render for Portal positioning — intentional ref read in render */}
          {/* eslint-disable react-hooks/refs */}
          <Box
            ref={dropdownRef}
            position="fixed"
            top={containerRef.current ? `${containerRef.current.getBoundingClientRect().bottom + 4}px` : 0}
            left={containerRef.current ? `${containerRef.current.getBoundingClientRect().left}px` : 0}
            width={containerRef.current ? `${containerRef.current.getBoundingClientRect().width}px` : '400px'}
            maxH="400px"
            overflowY="auto"
            bg="bg.panel"
            border="1px solid"
            borderColor="border.subtle"
            borderRadius="md"
            boxShadow="lg"
            zIndex={9999}
          >
            {pending || loading ? (
              <Box p={4} display="flex" alignItems="center" justifyContent="center" aria-label="Searching">
                <Spinner size="sm" color="accent.teal" mr={2} />
                <Text fontSize="sm" color="fg.muted">
                  Searching...
                </Text>
              </Box>
            ) : searchError ? (
              <HStack p={4} gap={2} aria-label="Search failed">
                <Icon as={LuTriangleAlert} color="accent.danger" boxSize={4} flexShrink={0} />
                <Text fontSize="sm" color="fg.muted">
                  Search failed — try again
                </Text>
              </HStack>
            ) : results.length === 0 ? (
              <Box p={4}>
                <Text fontSize="sm" color="fg.muted">
                  No results found for &quot;{query}&quot;
                </Text>
              </Box>
            ) : (
              <VStack align="stretch" gap={0} py={1}>
                {results.map((result, index) => {
                  // Guard: result types missing from FILE_TYPE_METADATA must not crash the dropdown
                  const metadata = FILE_TYPE_METADATA[result.type];
                  const IconComponent = metadata?.icon ?? LuFile;
                  const iconColor = metadata?.color ?? 'fg.muted';

                  return (
                    <Box
                      key={result.id}
                      aria-label={`Search result: ${getFileDisplayName(result)}`}
                      px={3}
                      py={2.5}
                      cursor="pointer"
                      bg={index === selectedIndex ? 'bg.subtle' : 'transparent'}
                      _hover={{ bg: 'bg.subtle' }}
                      onClick={() => handleNavigate(result)}
                      borderRadius="sm"
                      mx={1}
                    >
                      <HStack align="flex-start" gap={2.5}>
                        <Icon
                          as={IconComponent}
                          color={iconColor}
                          boxSize={4}
                          mt={0.5}
                          flexShrink={0}
                        />
                        <VStack align="flex-start" gap={0.5} flex={1} minW={0}>
                          <Text
                            fontSize="sm"
                            fontWeight={500}
                            color={isFileUntitled(result) ? 'fg.muted' : 'fg.default'}
                            lineClamp={1}
                            width="100%"
                          >
                            {getFileDisplayName(result)}
                          </Text>
                          <Text
                            fontSize="xs"
                            color="fg.muted"
                            lineClamp={1}
                            width="100%"
                            fontFamily="mono"
                          >
                            {result.path}
                          </Text>
                          {result.relevantResults.length > 0 && (
                            <Text
                              fontSize="xs"
                              color="fg.muted"
                              lineClamp={1}
                              width="100%"
                            >
                              {result.relevantResults[0].snippet}
                            </Text>
                          )}
                        </VStack>
                      </HStack>
                    </Box>
                  );
                })}
              </VStack>
            )}
          </Box>
          {/* eslint-enable react-hooks/refs */}
        </Portal>
      )}
    </Box>
  );
}
