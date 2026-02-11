/**
 * Jest setup file - runs before all tests
 * Clears environment variables to ensure tests are isolated
 */

// Clear backend URL - tests must explicitly set their own
delete process.env.NEXT_PUBLIC_BACKEND_URL;
delete process.env.BACKEND_URL;

// Set test timeout
jest.setTimeout(45000);
