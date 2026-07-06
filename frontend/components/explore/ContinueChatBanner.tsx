'use client';

import type { ComponentProps } from 'react';
import { Box, VStack, Text, Icon, Button, Grid, GridItem } from '@chakra-ui/react';
import { LuMessageSquare } from 'react-icons/lu';

export interface ParentPageInfo {
  id: number;
  name: string;
  type: string;
}

interface ContinueChatBannerProps {
  parentPageInfo: ParentPageInfo;
  navigate: (href: string) => void;
  colSpan: ComponentProps<typeof GridItem>['colSpan'];
  colStart: ComponentProps<typeof GridItem>['colStart'];
  onConfirm: () => void;
}

// Continue chat confirmation banner for conversations from other pages
export default function ContinueChatBanner({ parentPageInfo, navigate, colSpan, colStart, onConfirm }: ContinueChatBannerProps) {
  return (
    <Box
      position="sticky"
      bottom={0}
      bg="bg.canvas"
      pt={3}
      pb={{ base: 1, md: 3 }}
      px={4}
      zIndex={10}
    >
      <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }} gap={2} w="100%">
        <GridItem colSpan={colSpan} colStart={colStart}>
          <Box
            bg="bg.muted"
            borderWidth="1px"
            borderColor="border.default"
            borderRadius="lg"
            px={4}
            py={3}
          >
            <VStack align="center" gap={2}>
              <VStack align="center" gap={0.5}>
                <Text fontSize="sm" color="fg.default" fontFamily="mono" fontWeight="500">
                  This conversation started on{' '}
                  {parentPageInfo.type === 'slack' ? (
                    <Text as="span" color="accent.teal">Slack</Text>
                  ) : parentPageInfo.id > 0 ? (
                    <Text
                      as="span"
                      color="accent.teal"
                      cursor="pointer"
                      _hover={{ textDecoration: 'underline' }}
                      onClick={() => navigate(`/f/${parentPageInfo.id}`)}
                    >
                      {parentPageInfo.name}
                    </Text>
                  ) : (
                    <>a{' '}
                      <Text
                        as="span"
                        color="accent.teal"
                        cursor="pointer"
                        _hover={{ textDecoration: 'underline' }}
                        onClick={() => navigate(`/new/${parentPageInfo.type}`)}
                      >
                        new {parentPageInfo.type} page
                      </Text>
                    </>
                  )}
                </Text>
              </VStack>
              <Button
                size="sm"
                bg="accent.teal"
                color="white"
                _hover={{ opacity: 0.9 }}
                onClick={onConfirm}
              >
                <Icon as={LuMessageSquare} boxSize={4} mr={1} />
                Continue chat here
              </Button>
            </VStack>
          </Box>
        </GridItem>
      </Grid>
    </Box>
  );
}
