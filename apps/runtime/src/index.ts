import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from './config.js';
import { workspaceRouter } from './routes/workspaceRoutes.js';
import { fileRouter } from './routes/fileRoutes.js';
import { intelligenceRouter } from './routes/intelligenceRoutes.js';
import { workspaceService } from './services/workspaceService.js';
import { terminalService } from './services/terminalService.js';
import { RuntimeStatusResponse, ApiResponse } from '@minfy/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Health / Status check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/status', (_req, res: express.Response<ApiResponse<RuntimeStatusResponse>>) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      version: CONFIG.VERSION,
      platform: process.platform,
      workspacesCount: workspaceService.listWorkspaces().length,
    },
  });
});

// Routes
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
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  if (url.pathname === '/ws/terminal') {
    const workspaceId = url.searchParams.get('workspaceId');
    if (!workspaceId) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\nWorkspace ID required');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      terminalService.handleConnection(ws, workspaceId);
    });
  } else {
    socket.destroy();
  }
});

// Start Server strictly bound to loopback
export function startServer(port: number = CONFIG.PORT, host: string = CONFIG.HOST): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      console.log(`[Minfy Runtime] Server listening on http://${host}:${port}`);
      resolve(server);
    });
    server.on('error', (err) => {
      reject(err);
    });
  });
}

// Auto-start if run directly
if (process.argv[1] === __filename || process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error('[Minfy Runtime] Failed to start server:', err);
    process.exit(1);
  });
}
