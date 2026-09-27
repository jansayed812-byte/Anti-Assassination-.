/**
 * Phase 7: WebSocket Gateway
 */
import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';

export interface GatewayConfig {
  corsOrigins?: string[];
  maxClientsPerRoom?: number;
}

export class WebSocketGateway {
  private io: SocketServer;
  private clientCount = 0;

  constructor(httpServer: HttpServer, config: GatewayConfig = {}) {
    this.io = new SocketServer(httpServer, {
      cors: { origin: config.corsOrigins ?? ['http://localhost:3000'], methods: ['GET', 'POST'] },
      transports: ['websocket', 'polling'],
    });

    this.io.on('connection', (socket: Socket) => {
      this.clientCount++;
      socket.on('disconnect', () => this.clientCount--);
      socket.on('subscribe', (rooms: string[]) => { for (const room of rooms) socket.join(room); });
    });
  }

  broadcastPosition(data: unknown): void { this.io.emit('position', data); }
  broadcastIncident(data: unknown): void { this.io.emit('incident', data); }
  broadcastAlert(data: unknown): void { this.io.emit('alert', data); }
  broadcastRiskUpdate(data: unknown): void { this.io.to('risk').emit('risk_update', data); }
  sendToRoom(room: string, event: string, data: unknown): void { this.io.to(room).emit(event, data); }
  getClientCount(): number { return this.clientCount; }
  getIO(): SocketServer { return this.io; }
}
