'use client';

import { Box, Center, Text, Button, VStack } from '@chakra-ui/react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { useEffect, useRef } from 'react';
import { LuArrowLeft } from 'react-icons/lu';;

export default function FileNotFound() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const updateSize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    updateSize();
    window.addEventListener('resize', updateSize);

    // Particle system representing disconnected data points
    class DataPoint {
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
      opacity: number;
      pulsePhase: number;

      constructor(canvas: HTMLCanvasElement) {
        this.x = Math.random() * canvas.offsetWidth;
        this.y = Math.random() * canvas.offsetHeight;
        this.vx = (Math.random() - 0.5) * 0.4;
        this.vy = (Math.random() - 0.5) * 0.4;
        this.radius = Math.random() * 2.5 + 1.5;
        this.opacity = Math.random() * 0.5 + 0.4; // Increased opacity
        this.pulsePhase = Math.random() * Math.PI * 2;
      }

      update(canvas: HTMLCanvasElement) {
        this.x += this.vx;
        this.y += this.vy;
        this.pulsePhase += 0.015;

        // Bounce off edges
        if (this.x < 0 || this.x > canvas.offsetWidth) this.vx *= -1;
        if (this.y < 0 || this.y > canvas.offsetHeight) this.vy *= -1;
      }

      draw(ctx: CanvasRenderingContext2D) {
        const pulse = Math.sin(this.pulsePhase) * 0.15 + 1;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius * pulse, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(26, 188, 156, ${this.opacity * pulse})`; // Turquoise/cyan from theme
        ctx.fill();
      }
    }

    // Create particles
    const particles: DataPoint[] = [];
    for (let i = 0; i < 35; i++) {
      particles.push(new DataPoint(canvas));
    }

    // Animation loop
    let animationId: number;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);

      // Draw disconnected lines between nearby particles (representing broken connections)
      particles.forEach((p1, i) => {
        particles.slice(i + 1).forEach(p2 => {
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 120) {
            const opacity = (1 - distance / 120) * 0.2; // Increased opacity
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(127, 140, 141, ${opacity})`; // Muted gray from theme
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]); // Dashed lines for "broken" effect
            ctx.stroke();
            ctx.setLineDash([]); // Reset
          }
        });
      });

      // Update and draw particles
      particles.forEach(particle => {
        particle.update(canvas);
        particle.draw(ctx);
      });

      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', updateSize);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <Center
      position="relative"
      h="100vh"
      bg="bg.canvas"
      overflow="hidden"
    >
      {/* Animated background canvas */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          opacity: 0.8, // Increased opacity
        }}
      />

      {/* Gradient overlay for depth */}
      <Box
        position="absolute"
        top="0"
        left="0"
        right="0"
        bottom="0"
        bgGradient="radial(circle at 50% 50%, transparent 0%, bg.canvas 80%)"
        pointerEvents="none"
      />

      {/* Content */}
      <VStack
        gap={6}
        position="relative"
        zIndex={1}
        textAlign="center"
        px={8}
        maxW="600px"
        css={{
          animation: 'fadeInUp 0.8s ease-out',
          '@keyframes fadeInUp': {
            from: { opacity: 0, transform: 'translateY(30px)' },
            to: { opacity: 1, transform: 'translateY(0)' },
          },
        }}
      >
        {/* 404 Number with glitch effect */}
        <Box position="relative">
          <Text
            fontSize={{ base: '7xl', md: '8xl', lg: '9xl' }}
            fontWeight="900"
            lineHeight="1"
            color="accent.cyan"
            letterSpacing="-0.02em"
            fontFamily="heading"
            css={{
              textShadow: '0 0 30px rgba(26, 188, 156, 0.4)',
            }}
          >
            404
          </Text>
          {/* Decorative elements */}
          <Box
            position="absolute"
            top="50%"
            left="50%"
            transform="translate(-50%, -50%)"
            width="120%"
            height="120%"
            border="2px solid"
            borderColor="accent.cyan"
            opacity={0.2}
            borderRadius="lg"
            pointerEvents="none"
            css={{
              animation: 'rotate 20s linear infinite',
              '@keyframes rotate': {
                from: { transform: 'translate(-50%, -50%) rotate(0deg)' },
                to: { transform: 'translate(-50%, -50%) rotate(360deg)' },
              },
            }}
          />
        </Box>

        {/* Uh-oh message */}
        <Text
          fontSize="3xl"
          fontWeight="600"
          color="fg.emphasized"
          fontFamily="mono"
          mb={2}
        >
          Uh-oh!
        </Text>

        {/* Main message */}
        <Text
          fontSize="md"
          color="fg.muted"
          lineHeight="1.7"
          maxW="450px"
          fontFamily={"mono"}
        >
          This file doesn't exist or you don't have the necessary
          permissions to access it.
        </Text>

        {/* Action button */}
        <Box pt={6}>
          <Button
            size="xs"
            bg="accent.teal"
            color="white"
            px={8}
            fontFamily="body"
            fontWeight="600"
            _hover={{
              bg: 'accent.cyan',
              transform: 'translateY(-2px)',
              boxShadow: 'lg',
            }}
            _active={{
              transform: 'translateY(0)',
            }}
            transition="all 0.2s"
            onClick={() => router.back()}
          >
            <LuArrowLeft size={20} style={{ marginRight: '8px' }} />
            Go Back
          </Button>
        </Box>
      </VStack>
    </Center>
  );
}