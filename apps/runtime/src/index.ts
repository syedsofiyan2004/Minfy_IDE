import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from './config.js';
import { workspaceRouter } from './routes/workspaceRoutes.js';
import { fileRouter } from './routes/fileRoutes.js';
import { intelligenceRouter } from './routes/intelligenceRoutes.js';
import { aiRouter } from './routes/aiRoutes.js';
import { workspaceService } from './services/workspaceService.js';
import { terminalService } from './services/terminalService.js';
import { runtimeAuthService } from './services/runtimeAuthService.js';
import { terminalTicketService } from './services/terminalTicketService.js';
import { credentialStore } from './services/credentialStore.js';
import {
  hostValidationMiddleware,
  corsOriginMiddleware,
  runtimeAuthMiddleware,
  isAllowedHost,
  isAllowedOrigin,
} from './middleware/securityMiddleware.js';
import { RuntimeStatusResponse, ApiResponse } from '@minfy/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Security & Validation Middleware
app.use(hostValidationMiddleware);
app.use(corsOriginMiddleware);
app.use(express.json({ limit: '10mb' }));

// Public health probe endpoint (No Auth Required)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Centralized Runtime Authentication Middleware for all privileged endpoints
app.use(runtimeAuthMiddleware);

// Privileged Status Endpoint
app.get('/api/status', (_req, res: express.Response<ApiResponse<RuntimeStatusResponse>>) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      version: CONFIG.VERSION,
      platform: process.platform,
      workspacesCount: workspaceService.listWorkspaces().length,
      pid: process.pid,
      runtimeInstanceId: runtimeAuthService.getRuntimeInstanceId(),
    },
  });
});

// Privileged Routes
app.use('/api/ai', aiRouter);
app.use('/api/workspaces', workspaceRouter);
app.use('/api/workspaces/:id/intelligence', intelligenceRouter);
app.use('/api/workspaces/:id', fileRouter);

// Static Web App Serving (if web dist exists)
const webDistPath = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  app.get('*', (_req, res, next) => {
    if (_req.path.startsWith('/api/') || _req.path.startsWith('/ws/')) {
      return next();
    }
    res.sendFile(path.join(webDistPath, 'index.html'));
  });
}

// WebSocket Server for Integrated Terminal
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  // 1. Validate Host
  if (!isAllowedHost(request.headers.host)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\nInvalid Host header');
    socket.destroy();
    return;
  }

  // 2. Validate Origin
  if (!isAllowedOrigin(request.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\nForbidden Origin');
    socket.destroy();
    return;
  }

  const url = new URL(request.url || '', `http://${request.headers.host}`);
  if (url.pathname === '/ws/terminal') {
    // 3. Validate and consume short-lived one-time ticket
    const ticket = url.searchParams.get('ticket');
    const ticketResult = terminalTicketService.consumeTicket(ticket || undefined);

    if (!ticketResult.valid || !ticketResult.workspaceId) {
      socket.write(`HTTP/1.1 401 Unauthorized\r\n\r\n${ticketResult.error || 'Terminal authorization failed'}`);
      socket.destroy();
      return;
    }

    const boundWorkspaceId = ticketResult.workspaceId;

    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      terminalService.handleConnection(ws, boundWorkspaceId);
    });
  } else {
    socket.destroy();
  }
});

// Start Server strictly bound to loopback
export async function startServer(
  port: number = CONFIG.PORT,
  host: string = CONFIG.HOST,
  maxRetries: number = 6
): Promise<http.Server> {
  await credentialStore.loadInitialCredentials(['openrouter']).catch(() => {});

  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await new Promise<http.Server>((resolve, reject) => {
        const onError = (err: any) => {
          server.removeListener('error', onError);
          reject(err);
        };
        server.once('error', onError);
        server.listen(port, host, () => {
          server.removeListener('error', onError);
          runtimeAuthService.saveRuntimeState(port);
          console.log(`[Minfy Runtime] Server listening on http://${host}:${port}`);
          resolve(server);
        });
      });
    } catch (err: any) {
      if (err.code === 'EADDRINUSE' && attempt < maxRetries - 1) {
        attempt++;
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Failed to bind to http://${host}:${port}`);
}

// Cleanup runtime state on process termination
process.on('exit', () => {
  runtimeAuthService.cleanup();
});

process.on('SIGINT', () => {
  runtimeAuthService.cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  runtimeAuthService.cleanup();
  process.exit(0);
});

// Auto-start if run directly
if (process.argv[1] === __filename || process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error('[Minfy Runtime] Failed to start server:', err);
    process.exit(1);
  });
}
