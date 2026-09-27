/**
 * Phase 7: WebSocket Gateway
 */
import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';

export interface GatewayConfig {
  corsOrigins?: string[];
  maxClientsPerRoom?: number;
  /** Validates the handshake token (socket.handshake.auth.token); return claims to accept or null to reject. */
  authenticate?: (token: string | undefined) => unknown | null;
  onConnection?: (socket: Socket) => void;
}

export class WebSocketGateway {
  private io: SocketServer;
  private clientCount = 0;

  constructor(httpServer: HttpServer, config: GatewayConfig = {}) {
    this.io = new SocketServer(httpServer, {
      cors: { origin: config.corsOrigins ?? ['http://localhost:3000'], methods: ['GET', 'POST'] },
      transports: ['websocket', 'polling'],
    });

    if (config.authenticate) {
      const authenticate = config.authenticate;
      this.io.use((socket, next) => {
        const claims = authenticate(socket.handshake.auth?.token);
        if (!claims) return next(new Error('unauthorized'));
        socket.data.user = claims;
        next();
      });
    }

    this.io.on('connection', (socket: Socket) => {
      this.clientCount++;
      socket.on('disconnect', () => this.clientCount--);
      socket.on('subscribe', (rooms: string[]) => { for (const room of rooms) socket.join(room); });
      config.onConnection?.(socket);
    });
  }

  broadcastPosition(data: unknown): void { this.io.emit('position', data); }
  broadcastIncident(data: unknown): void { this.io.emit('incident', data); }
  broadcastAlert(data: unknown): void { this.io.emit('alert', data); }
  broadcastRiskUpdate(data: unknown): void { this.io.to('risk').emit('risk_update', data); }
  broadcast(event: string, data: unknown): void { this.io.emit(event, data); }
  sendToRoom(room: string, event: string, data: unknown): void { this.io.to(room).emit(event, data); }
  getClientCount(): number { return this.clientCount; }
  getIO(): SocketServer { return this.io; }
  close(): Promise<void> { return new Promise((resolve) => this.io.close(() => resolve())); }
}
