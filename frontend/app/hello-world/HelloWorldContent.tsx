'use client';

import { useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Box, Heading, Text, Flex } from '@chakra-ui/react';
import { LuPlay, LuDatabase } from 'react-icons/lu';
import { useAppDispatch } from '@/store/hooks';
import { setLeftSidebarCollapsed } from '@/store/uiSlice';
import { switchMode } from '@/lib/mode/mode-utils';

export function HelloWorldContent() {
  const dispatch = useAppDispatch();
  const orb1Ref = useRef<HTMLDivElement>(null);
  const orb2Ref = useRef<HTMLDivElement>(null);
  const orb3Ref = useRef<HTMLDivElement>(null);

  const moveOrb = useCallback((orb: HTMLDivElement | null, rangeX: number, rangeY: number) => {
    if (!orb) return;
    const x = Math.random() * rangeX * 2 - rangeX;
    const y = Math.random() * rangeY * 2 - rangeY;
    orb.style.transform = `translate(${x}px, ${y}px)`;
  }, []);

  // Collapse the left sidebar on page load
  useEffect(() => {
    dispatch(setLeftSidebarCollapsed(true));
  }, [dispatch]);

  // Random orb movement
  useEffect(() => {
    const moveOrbs = () => {
      moveOrb(orb1Ref.current, 400, 200);
      moveOrb(orb2Ref.current, 300, 250);
      moveOrb(orb3Ref.current, 350, 200);
    };

    // Initial movement
    moveOrbs();

    // Set up intervals with different timings for each orb
    const interval1 = setInterval(() => moveOrb(orb1Ref.current, 400, 200), 3000 + Math.random() * 2000);
    const interval2 = setInterval(() => moveOrb(orb2Ref.current, 300, 250), 4000 + Math.random() * 2000);
    const interval3 = setInterval(() => moveOrb(orb3Ref.current, 350, 200), 3500 + Math.random() * 2000);

    return () => {
      clearInterval(interval1);
      clearInterval(interval2);
      clearInterval(interval3);
    };
  }, [moveOrb]);

  return (
    <Box
      minH="100vh"
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      bg="bg.canvas"
      position="relative"
      overflow="hidden"
      px={4}
    >
      {/* Background effects */}
      <Box
        position="absolute"
        inset={0}
        zIndex={0}
        pointerEvents="none"
        css={{
          background: `
            radial-gradient(ellipse 80% 50% at 50% -20%, rgba(26, 188, 156, 0.35), transparent),
            radial-gradient(ellipse 60% 40% at 100% 100%, rgba(26, 188, 156, 0.2), transparent),
            radial-gradient(ellipse 50% 40% at 0% 80%, rgba(26, 188, 156, 0.15), transparent)
          `,
        }}
      />

      {/* Floating orbs */}
      <Box
        ref={orb1Ref}
        className="orb orb-1"
        position="absolute"
        w="400px"
        h="400px"
        borderRadius="full"
        bg="accent.teal"
        opacity={0.15}
        filter="blur(80px)"
        zIndex={0}
        pointerEvents="none"
      />
      <Box
        ref={orb2Ref}
        className="orb orb-2"
        position="absolute"
        w="300px"
        h="300px"
        borderRadius="full"
        bg="accent.teal"
        opacity={0.17}
        filter="blur(60px)"
        zIndex={0}
        pointerEvents="none"
      />
      <Box
        ref={orb3Ref}
        className="orb orb-3"
        position="absolute"
        w="250px"
        h="250px"
        borderRadius="full"
        bg="accent.teal"
        opacity={0.2}
        filter="blur(70px)"
        zIndex={0}
        pointerEvents="none"
      />

      {/* Content container */}
      <Box position="relative" zIndex={1} textAlign="center" mb={10}>
        <Heading
          fontSize={{ base: '4xl', md: '6xl' }}
          fontFamily="mono"
          mb={4}
          css={{
            animation: 'fadeInUp 0.5s ease-out forwards',
            opacity: 0,
          }}
        >
          Welcome to MinusX!
        </Heading>
        <Text
          color="fg.muted"
          fontSize={{ base: 'lg', md: 'xl' }}
          css={{
            animation: 'fadeInUp 0.5s ease-out 0.05s forwards',
            opacity: 0,
          }}
        >
          Choose your own adventure
        </Text>
      </Box>

      {/* Cards container */}
      <Flex
        direction={{ base: 'column', md: 'row' }}
        gap={8}
        position="relative"
        zIndex={1}
      >
        {/* Try Demo Card */}
        <Box
          className="border-card"
          position="relative"
          borderRadius="xl"
          cursor="pointer"
          transition="transform 0.2s ease-out"
          onClick={() => switchMode('tutorial')}
          _hover={{
            transform: 'translateY(-4px)',
          }}
          css={{
            animation: 'fadeInUp 0.5s ease-out 0.1s forwards',
            opacity: 0,
          }}
        >
          <Box
            border={"2px solid"}
            borderColor={"border.default"}
            className="border-card-inner"
            bg="bg.surface"
            borderRadius="xl"
            p={10}
            w={{ base: 'full', md: '320px' }}
            minW="320px"
            textAlign="center"
            position="relative"
            zIndex={1}
          >
            <Box
              display="flex"
              justifyContent="center"
              alignItems="center"
              mb={5}
              color="accent.teal"
            >
              <LuPlay size={56} />
            </Box>
            <Heading size="xl" fontFamily="mono" mb={3}>
              Try Demo
            </Heading>
            <Text color="fg.muted" fontSize="md">
              Explore with sample datasets - no setup needed
            </Text>
          </Box>
        </Box>

        {/* Setup MinusX Card */}
        <Link href="/new/connection" style={{ textDecoration: 'none' }}>
          <Box
            className="border-card"
            position="relative"
            borderRadius="xl"
            cursor="pointer"
            transition="transform 0.2s ease-out"
            _hover={{
              transform: 'translateY(-4px)',
            }}
            css={{
              animation: 'fadeInUp 0.5s ease-out 0.2s forwards',
              opacity: 0,
            }}
          >
            <Box
              border={"2px solid"}
              borderColor={"border.default"}
              className="border-card-inner"
              bg="bg.surface"
              borderRadius="xl"
              p={10}
              w={{ base: 'full', md: '320px' }}
              minW="320px"
              textAlign="center"
              position="relative"
              zIndex={1}
            >
              <Box
                display="flex"
                justifyContent="center"
                alignItems="center"
                mb={5}
                color="accent.teal"
              >
                <LuDatabase size={56} />
              </Box>
              <Heading size="xl" fontFamily="mono" mb={3}>
                Wire up your Data
              </Heading>
              <Text color="fg.muted" fontSize="md">
                Connect your database and dive in
              </Text>
            </Box>
          </Box>
        </Link>
      </Flex>

      {/* Global keyframes */}
      <style jsx global>{`
        @property --border-angle {
          syntax: '<angle>';
          initial-value: 0deg;
          inherits: false;
        }

        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes rotateBorder {
          from {
            --border-angle: 0deg;
          }
          to {
            --border-angle: 360deg;
          }
        }

        .border-card {
          padding: 2px;
          background: var(--chakra-colors-border-default);
        }

        .border-card::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 2px;
          background: conic-gradient(
            from var(--border-angle),
            rgba(26, 188, 156, 0) 0%,
            rgba(26, 188, 156, 1) 10%,
            rgba(26, 188, 156, 0) 20%
          );
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        .border-card:hover::before {
          opacity: 1;
          animation: rotateBorder 2s linear infinite;
        }

        /* Floating orbs - random movement via JS */
        .orb {
          transition: transform 4s cubic-bezier(0.25, 0.1, 0.25, 1);
        }

        .orb-1 {
          top: 10%;
          left: 15%;
        }

        .orb-2 {
          bottom: 20%;
          right: 10%;
        }

        .orb-3 {
          top: 60%;
          left: 60%;
        }
      `}</style>
    </Box>
  );
}
