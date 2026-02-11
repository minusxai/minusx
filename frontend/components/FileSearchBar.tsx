'use client';

import { useState, useEffect, useRef, KeyboardEvent } from 'react';
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
import { LuSearch } from 'react-icons/lu';
import { useRouter } from '@/lib/navigation/use-navigation';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import type { SearchResultMetadata } from '@/lib/search/file-search';
import { useFetchManual } from '@/lib/api/useFetch';
import { API } from '@/lib/api/declarations';

interface FileSearchBarProps {
  onResultClick?: (fileId: number) => void;
}

export default function FileSearchBar({ onResultClick }: FileSearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultMetadata[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Use centralized fetch with automatic deduplication
  const [searchFiles, { loading }] = useFetchManual(API.files.search);

  // Debounced search effect
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        const data = await searchFiles({
          query: query.trim(),
          limit: 10 // Show top 10 results
        }) as any;
        setResults(data.results || []);
        setShowDropdown(true);
        setSelectedIndex(0);
      } catch (error) {
        console.error('Search error:', error);
        setResults([]);
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
        setShowDropdown(false);
        setIsFocused(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNavigate = (result: SearchResultMetadata) => {
    setQuery('');
    setResults([]);
    setShowDropdown(false);
    setIsFocused(false);
    inputRef.current?.blur();

    if (onResultClick) {
      onResultClick(result.id);
    } else {
      // Navigate to folder path for folders, file detail for everything else
      if (result.type === 'folder') {
        router.push(`/p${result.path}`);
      } else {
        router.push(`/f/${result.id}`);
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || results.length === 0) {
      if (e.key === 'Escape') {
        inputRef.current?.blur();
        setShowDropdown(false);
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
        setShowDropdown(false);
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
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setIsFocused(true);
            if (query.trim() && results.length > 0) {
              setShowDropdown(true);
            }
          }}
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
      {showDropdown && (
        <Portal>
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
            {loading ? (
              <Box p={4} display="flex" alignItems="center" justifyContent="center">
                <Spinner size="sm" color="accent.teal" mr={2} />
                <Text fontSize="sm" color="fg.muted">
                  Searching...
                </Text>
              </Box>
            ) : results.length === 0 ? (
              <Box p={4}>
                <Text fontSize="sm" color="fg.muted">
                  No results found for &quot;{query}&quot;
                </Text>
              </Box>
            ) : (
              <VStack align="stretch" gap={0} py={1}>
                {results.map((result, index) => {
                  const metadata = FILE_TYPE_METADATA[result.type];
                  const IconComponent = metadata.icon;

                  return (
                    <Box
                      key={result.id}
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
                          color={metadata.color}
                          boxSize={4}
                          mt={0.5}
                          flexShrink={0}
                        />
                        <VStack align="flex-start" gap={0.5} flex={1} minW={0}>
                          <Text
                            fontSize="sm"
                            fontWeight={500}
                            color="fg.default"
                            lineClamp={1}
                            width="100%"
                          >
                            {result.name}
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
        </Portal>
      )}
    </Box>
  );
}
