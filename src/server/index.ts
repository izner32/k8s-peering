import express, { Request, Response } from 'express';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger, format, transports } from 'winston';
import * as chokidar from 'chokidar';

// Logger configuration
const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}] ${message}`;
    })
  ),
  transports: [new transports.Console()],
});

interface PeerConfig {
  host: string;
  port: number;
}

interface ServerConfig {
  peers: PeerConfig[];
  pingInterval: number; // in milliseconds
}

class PeeringServer {
  private app: express.Application;
  private port: number;
  private serverName: string;
  private config: ServerConfig;
  private configPath: string;
  private pingIntervalId?: NodeJS.Timeout;
  private configWatcher?: chokidar.FSWatcher;

  constructor(port: number, configPath: string) {
    this.app = express();
    this.port = port;
    this.serverName = process.env.POD_NAME || process.env.HOSTNAME || `server-${port}`;
    this.configPath = configPath;
    this.config = { peers: [], pingInterval: 60000 }; // Default 60 seconds

    this.setupRoutes();
    this.loadConfig();
    this.watchConfig();
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      res.status(200).send('ok\n');
    });

    // Ping endpoint
    this.app.get('/ping', (req: Request, res: Response) => {
      logger.info(`Received ping from ${req.ip}`);
      res.status(200).send('pong\n');
    });

    // Config endpoint (for debugging)
    this.app.get('/config', (req: Request, res: Response) => {
      res.status(200).json({
        serverName: this.serverName,
        config: this.config,
      });
    });
  }

  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf-8');
        const newConfig: ServerConfig = JSON.parse(configData);

        const oldPeerCount = this.config.peers.length;
        const newPeerCount = newConfig.peers.length;

        this.config = newConfig;

        logger.info(`Configuration loaded from ${this.configPath}`);
        logger.info(`Peers updated: ${oldPeerCount} -> ${newPeerCount}`);
        logger.info(`Ping interval: ${this.config.pingInterval}ms`);

        // Restart ping interval with new configuration
        this.startPinging();
      } else {
        logger.warn(`Config file not found at ${this.configPath}, using defaults`);
      }
    } catch (error) {
      logger.error(`Error loading config: ${error}`);
    }
  }

  private watchConfig(): void {
    // BONUS: Hot-reload configuration without restarting the pod
    logger.info(`Watching configuration file: ${this.configPath}`);

    this.configWatcher = chokidar.watch(this.configPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.configWatcher.on('change', (path) => {
      logger.info(`Configuration file changed: ${path}`);
      this.loadConfig();
    });

    this.configWatcher.on('error', (error) => {
      logger.error(`Config watcher error: ${error}`);
    });
  }

  private async pingPeer(peer: PeerConfig): Promise<void> {
    const url = `http://${peer.host}:${peer.port}/ping`;
    try {
      const response = await axios.get(url, {
        timeout: 5000,
        headers: {
          'User-Agent': `PeeringServer/${this.serverName}`,
        },
      });

      // Log successful ping response
      logger.info(`✓ Pinged ${peer.host}:${peer.port} -> Response: ${response.data.trim()}`);
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        logger.warn(`✗ Peer ${peer.host}:${peer.port} is not reachable (connection refused)`);
      } else if (error.code === 'ETIMEDOUT') {
        logger.warn(`✗ Peer ${peer.host}:${peer.port} timed out`);
      } else {
        logger.error(`✗ Error pinging ${peer.host}:${peer.port}: ${error.message}`);
      }
    }
  }

  private async pingAllPeers(): Promise<void> {
    if (this.config.peers.length === 0) {
      logger.debug('No peers configured to ping');
      return;
    }

    logger.info(`Pinging ${this.config.peers.length} peer(s)...`);

    // Ping all peers concurrently
    const pingPromises = this.config.peers.map((peer) => this.pingPeer(peer));
    await Promise.allSettled(pingPromises);
  }

  private startPinging(): void {
    // Clear existing interval if any
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
    }

    // Start pinging immediately
    this.pingAllPeers();

    // Set up interval for subsequent pings
    this.pingIntervalId = setInterval(() => {
      this.pingAllPeers();
    }, this.config.pingInterval);

    logger.info(`Ping interval set to ${this.config.pingInterval}ms`);
  }

  public start(): void {
    const server = this.app.listen(this.port, '0.0.0.0', () => {
      logger.info(`========================================`);
      logger.info(`Server: ${this.serverName}`);
      logger.info(`Listening on port: ${this.port}`);
      logger.info(`Config path: ${this.configPath}`);
      logger.info(`========================================`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully...');

      if (this.pingIntervalId) {
        clearInterval(this.pingIntervalId);
      }

      if (this.configWatcher) {
        this.configWatcher.close();
      }

      server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down gracefully...');

      if (this.pingIntervalId) {
        clearInterval(this.pingIntervalId);
      }

      if (this.configWatcher) {
        this.configWatcher.close();
      }

      server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });
    });
  }
}

// Main execution
const PORT = parseInt(process.env.PORT || '8080', 10);
const CONFIG_PATH = process.env.CONFIG_PATH || '/etc/peering/config.json';

const server = new PeeringServer(PORT, CONFIG_PATH);
server.start();
