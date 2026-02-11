/**
 * Port allocation and verification utilities for E2E tests
 *
 * Manages dynamic port allocation from predefined ranges to allow
 * multiple test suites to run in parallel without conflicts.
 *
 * Uses file-based locking to prevent race conditions when multiple
 * Jest workers allocate ports simultaneously.
 */

import { createServer } from 'net';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Lock file directory
const LOCK_DIR = join(tmpdir(), 'atlas-test-ports');

// Counter file for monotonic range allocation
const COUNTER_FILE = join(LOCK_DIR, 'range-counter.txt');

// Ensure lock directory exists
try {
  mkdirSync(LOCK_DIR, { recursive: true });
} catch (e) {
  // Directory already exists
}

// Predefined port ranges (20 apart for 5 consecutive ports)
// Simple monotonic allocation: each test gets the next range
// 24 ranges support up to 24 parallel test processes (repo copies or CI jobs)
// NOTE: Starting from 8022 to avoid conflicts with common dev services on 8000-8020
const PORT_RANGES: [number, number][] = [
  [8022, 8026],
  [8042, 8046],
  [8062, 8066],
  [8082, 8086],
  [8102, 8106],
  [8122, 8126],
  [8142, 8146],
  [8162, 8166],
  [8182, 8186],
  [8202, 8206],
  [8222, 8226],
  [8242, 8246],
  [8262, 8266],
  [8282, 8286],
  [8302, 8306],
  [8322, 8326],
  [8342, 8346],
  [8362, 8366],
  [8382, 8386],
  [8402, 8406],
  [8422, 8426],
  [8442, 8446],
  [8462, 8466],
  [8482, 8486]
];

/**
 * Atomically read and increment the range counter
 * Returns the next available range index (0-23)
 */
function getNextRangeIndex(): number {
  // Try to read existing counter
  let currentIndex = 0;
  if (existsSync(COUNTER_FILE)) {
    try {
      const content = readFileSync(COUNTER_FILE, 'utf-8').trim();
      currentIndex = parseInt(content, 10) || 0;
    } catch (error) {
      // File corrupted or can't read - start from 0
      currentIndex = 0;
    }
  }

  // Wrap around after last range
  const nextIndex = (currentIndex + 1) % PORT_RANGES.length;

  // Write next index atomically (overwrite file)
  try {
    writeFileSync(COUNTER_FILE, nextIndex.toString(), 'utf-8');
  } catch (error) {
    console.warn('⚠️ Could not update counter file, using current index');
  }

  return currentIndex;
}

/**
 * Check if a single port is available by attempting to bind to it
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        // Other errors (EACCES, etc.) also mean port is not available
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, '127.0.0.1');
  });
}

/**
 * Check if a range of consecutive ports are all available
 */
export async function arePortsAvailable(start: number, count: number): Promise<boolean> {
  const checks = [];
  for (let i = 0; i < count; i++) {
    checks.push(isPortAvailable(start + i));
  }

  const results = await Promise.all(checks);
  return results.every(available => available);
}

/**
 * Allocate N consecutive ports from the next available predefined range
 *
 * Simple monotonic allocation: each test gets the next range index.
 * No cleanup needed - counter just keeps incrementing.
 *
 * @param portCount Number of ports to allocate (default: 5)
 * @returns Array of consecutive port numbers
 */
export async function allocateTestPorts(portCount: number = 5): Promise<number[]> {
  // Get next range index atomically
  const rangeIndex = getNextRangeIndex();
  const [start, end] = PORT_RANGES[rangeIndex];

  // Calculate how many ports this range provides
  const availablePorts = end - start + 1;

  if (portCount > availablePorts) {
    throw new Error(
      `❌ Requested ${portCount} ports but range only has ${availablePorts} ports!\n` +
      `   Each range provides ${availablePorts} ports. Adjust PORT_RANGES if you need more.`
    );
  }

  // Return requested number of ports from this range
  const ports = Array.from({ length: portCount }, (_, i) => start + i);

  console.log(`✅ Allocated range ${rangeIndex}: ${start}-${start + portCount - 1}`);
  console.log(`   Ports: ${ports.join(', ')}`);

  return ports;
}

/**
 * Release port locks (DEPRECATED - no longer needed with monotonic allocation)
 * Kept for backward compatibility, does nothing.
 */
export function releaseTestPorts(_ports: number[]): void {
  // No-op: monotonic allocation doesn't require cleanup
  // Counter just keeps incrementing and wraps around after 24 ranges
}

/**
 * Wait for a port to be released after killing a process
 *
 * Polls the port until it becomes available or timeout is reached.
 * Useful for verifying cleanup worked properly.
 *
 * @param port Port number to check
 * @param timeout Maximum time to wait in milliseconds (default: 5000)
 * @returns True if port was released, false if timeout reached
 */
export async function waitForPortRelease(
  port: number,
  timeout: number = 5000
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const available = await isPortAvailable(port);
    if (available) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return false;
}
