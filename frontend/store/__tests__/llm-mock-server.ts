/**
 * LLM Mock Server for E2E Tests
 *
 * Provides a lightweight HTTP server that Python backend calls instead of real LLM API.
 * Allows tests to dynamically configure responses and validate requests.
 *
 * Usage:
 *   const server = new LLMMockServer(9000);
 *   await server.start();
 *
 *   // Configure response for next LLM call
 *   await server.configure({
 *     validateRequest: (req) => {
 *       expect(req.messages[0].role).toBe('user');
 *       return true;
 *     },
 *     response: { content: "...", tool_calls: [...], finish_reason: "tool_calls" },
 *     usage: { total_tokens: 100, prompt_tokens: 50, completion_tokens: 50 }
 *   });
 */

import express from 'express';
import type { Express, Request, Response } from 'express';
import { waitForPortRelease } from './port-manager';

// Types matching Python backend
export interface ALLMRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
    function?: {
      name: string;
      arguments?: string;
    };
  }>;
  llmSettings?: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
    response_format?: any;
    tool_choice?: string;
  };
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters?: any;
    };
  }>;
}

export interface LLMResponse {
  content: string;
  role: 'assistant';
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  stream_id?: string;
  finish_reason: 'stop' | 'tool_calls' | 'length';
}

export interface LLMUsage {
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  completion_tokens_details?: any;
  prompt_tokens_details?: any;
}

export interface MockConfig {
  validateRequest?: (req: ALLMRequest) => boolean | void;
  response: LLMResponse;
  usage: LLMUsage;
}

interface CallRecord {
  timestamp: string;
  request: ALLMRequest;
  response: LLMResponse;
  usage: LLMUsage;
}

export class LLMMockServer {
  private app: Express;
  private server: any;
  private port: number;
  private configQueue: MockConfig[] = [];
  private calls: CallRecord[] = [];

  constructor(port: number = 8003) {
    this.port = port;
    this.app = express();
    this.app.use(express.json({ limit: '50mb' }));

    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Configure endpoint - called by test to set next response(s)
    this.app.post('/mock/configure', (req: Request, res: Response) => {
      try {
        // Support both single config and array of configs
        const configs = Array.isArray(req.body) ? req.body : [req.body];

        // Add configs to queue
        for (const config of configs) {
          this.configQueue.push({
            validateRequest: config.validateRequest
              ? eval(`(${config.validateRequest})`) // Convert string to function if needed
              : undefined,
            response: config.response,
            usage: config.usage
          });
        }
        res.json({ success: true, queued: configs.length });
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });

    // LLM endpoint - called by Python backend
    this.app.post('/mock/llm', (req: Request, res: Response) => {
      try {
        const request = req.body as ALLMRequest;

        // Pop next config from queue
        const currentConfig = this.configQueue.shift();

        if (!currentConfig) {
          return res.status(500).json({
            error: 'No mock configured. Call POST /mock/configure first or queue is empty.'
          });
        }

        // Validate request if validator provided
        if (currentConfig.validateRequest) {
          try {
            currentConfig.validateRequest(request);
          } catch (error: any) {
            console.error('❌ LLM request validation failed:', error.message);
            return res.status(400).json({
              error: 'Request validation failed',
              details: error.message
            });
          }
        }

        const response = currentConfig.response;
        const usage = currentConfig.usage;

        // Record call for later assertions
        this.calls.push({
          timestamp: new Date().toISOString(),
          request,
          response,
          usage
        });

        // Log for debugging
        console.log(`📞 LLM Mock called (${this.calls.length} total calls)`);
        console.log(`   Messages: ${request.messages.length}`);
        console.log(`   Tools: ${request.tools?.length || 0}`);
        console.log(`   Response: ${response.tool_calls?.length || 0} tool calls`);

        // Return in format expected by Python backend
        res.json({ response, usage });
      } catch (error: any) {
        console.error('❌ Error in /mock/llm:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Get call history - for test assertions
    this.app.get('/mock/calls', (req: Request, res: Response) => {
      res.json(this.calls);
    });

    // Reset state - clean between tests
    this.app.post('/mock/reset', (req: Request, res: Response) => {
      this.configQueue = [];
      this.calls = [];
      res.json({ success: true });
    });

    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'healthy', calls: this.calls.length });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`✅ LLM Mock Server running on http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        // Force close connections after timeout - store handle to clear it
        const forceCloseTimeout = setTimeout(() => {
          if (this.server) {
            // Force close all active connections (Node 18.2+)
            if (typeof (this.server as any).closeAllConnections === 'function') {
              (this.server as any).closeAllConnections();
            }
          }
        }, 3000);

        // Close HTTP server
        this.server.close(async (err: Error | undefined) => {
          // Clear the force close timeout since we're closing gracefully
          clearTimeout(forceCloseTimeout);

          if (err) {
            console.error('Error closing LLM Mock Server:', err);
          }

          // Verify port released
          const released = await waitForPortRelease(this.port, 5000);
          if (!released) {
            console.warn(`⚠️ LLM Mock port ${this.port} not released after 5s`);
          }

          console.log('🛑 LLM Mock Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // Helper methods for tests
  async configure(config: MockConfig | MockConfig[]): Promise<void> {
    const configs = Array.isArray(config) ? config : [config];

    const response = await fetch(`http://localhost:${this.port}/mock/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        configs.map(c => ({
          // Convert function to string if needed (for serialization)
          validateRequest: c.validateRequest?.toString(),
          response: c.response,
          usage: c.usage
        }))
      )
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to configure mock: ${error.error}`);
    }
  }

  async getCalls(): Promise<CallRecord[]> {
    const response = await fetch(`http://localhost:${this.port}/mock/calls`);
    return response.json();
  }

  async reset(): Promise<void> {
    try {
      await fetch(`http://localhost:${this.port}/mock/reset`, { method: 'POST' });
    } catch (error) {
      // Ignore errors if server is not running (e.g., after afterAll in parallel tests)
      console.log(`⚠️ Could not reset LLM Mock Server on port ${this.port} (may be stopped)`);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${this.port}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
