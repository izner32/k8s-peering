import * as k8s from '@kubernetes/client-node';
import { createLogger, format, transports } from 'winston';

// Logger configuration
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}] ${message}`;
    })
  ),
  transports: [new transports.Console()],
});

interface PeeringServerSpec {
  replicas: number;
  pingInterval: number;
  port?: number;
  image?: string;
  resources?: {
    requests?: {
      cpu?: string;
      memory?: string;
    };
    limits?: {
      cpu?: string;
      memory?: string;
    };
  };
}

interface PeeringServerStatus {
  replicas?: number;
  readyReplicas?: number;
  phase?: string;
  lastUpdated?: string;
}

interface PeeringServer {
  apiVersion: string;
  kind: string;
  metadata: k8s.V1ObjectMeta;
  spec: PeeringServerSpec;
  status?: PeeringServerStatus;
}

class PeeringServerOperator {
  private kc: k8s.KubeConfig;
  private k8sApi: k8s.CoreV1Api;
  private k8sAppsApi: k8s.AppsV1Api;
  private k8sCustomApi: k8s.CustomObjectsApi;
  private watch: k8s.Watch;
  private namespace: string;

  constructor() {
    this.kc = new k8s.KubeConfig();

    // Load config from cluster or local kubeconfig
    if (process.env.KUBERNETES_SERVICE_HOST) {
      this.kc.loadFromCluster();
    } else {
      this.kc.loadFromDefault();
    }

    this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.k8sAppsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.k8sCustomApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
    this.watch = new k8s.Watch(this.kc);
    this.namespace = process.env.WATCH_NAMESPACE || 'default';
  }

  private generatePeerList(name: string, namespace: string, replicas: number, port: number): Array<{ host: string; port: number }> {
    const peers: Array<{ host: string; port: number }> = [];

    // Generate peer list for StatefulSet pods
    for (let i = 0; i < replicas; i++) {
      const podName = `${name}-${i}`;
      const host = `${podName}.${name}-headless.${namespace}.svc.cluster.local`;
      peers.push({ host, port });
    }

    return peers;
  }

  private createConfigMap(
    peeringServer: PeeringServer,
    peers: Array<{ host: string; port: number }>
  ): k8s.V1ConfigMap {
    const name = peeringServer.metadata.name!;
    const namespace = peeringServer.metadata.namespace || this.namespace;
    const config = {
      peers,
      pingInterval: peeringServer.spec.pingInterval,
    };

    return {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: `${name}-config`,
        namespace,
        labels: {
          app: name,
          'managed-by': 'peering-operator',
        },
        ownerReferences: [
          {
            apiVersion: peeringServer.apiVersion,
            kind: peeringServer.kind,
            name: name,
            uid: peeringServer.metadata.uid!,
            controller: true,
            blockOwnerDeletion: true,
          },
        ],
      },
      data: {
        'config.json': JSON.stringify(config, null, 2),
      },
    };
  }

  private createHeadlessService(peeringServer: PeeringServer): k8s.V1Service {
    const name = peeringServer.metadata.name!;
    const namespace = peeringServer.metadata.namespace || this.namespace;
    const port = peeringServer.spec.port || 8080;

    return {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: `${name}-headless`,
        namespace,
        labels: {
          app: name,
          'managed-by': 'peering-operator',
        },
        ownerReferences: [
          {
            apiVersion: peeringServer.apiVersion,
            kind: peeringServer.kind,
            name: name,
            uid: peeringServer.metadata.uid!,
            controller: true,
            blockOwnerDeletion: true,
          },
        ],
      },
      spec: {
        clusterIP: 'None', // Headless service
        selector: {
          app: name,
        },
        ports: [
          {
            name: 'http',
            port,
            targetPort: port as any,
            protocol: 'TCP',
          },
        ],
      },
    };
  }

  private createStatefulSet(peeringServer: PeeringServer): k8s.V1StatefulSet {
    const name = peeringServer.metadata.name!;
    const namespace = peeringServer.metadata.namespace || this.namespace;
    const port = peeringServer.spec.port || 8080;
    const image = peeringServer.spec.image || 'peering-server:latest';

    // Resource requests and limits with defaults
    const resources = {
      requests: {
        cpu: peeringServer.spec.resources?.requests?.cpu || '100m',
        memory: peeringServer.spec.resources?.requests?.memory || '128Mi',
      },
      limits: {
        cpu: peeringServer.spec.resources?.limits?.cpu || '200m',
        memory: peeringServer.spec.resources?.limits?.memory || '256Mi',
      },
    };

    return {
      apiVersion: 'apps/v1',
      kind: 'StatefulSet',
      metadata: {
        name,
        namespace,
        labels: {
          app: name,
          'managed-by': 'peering-operator',
        },
        ownerReferences: [
          {
            apiVersion: peeringServer.apiVersion,
            kind: peeringServer.kind,
            name: name,
            uid: peeringServer.metadata.uid!,
            controller: true,
            blockOwnerDeletion: true,
          },
        ],
      },
      spec: {
        serviceName: `${name}-headless`,
        replicas: peeringServer.spec.replicas,
        selector: {
          matchLabels: {
            app: name,
          },
        },
        template: {
          metadata: {
            labels: {
              app: name,
            },
          },
          spec: {
            // BONUS: Security best practices
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1001,
              fsGroup: 1001,
              seccompProfile: {
                type: 'RuntimeDefault',
              },
            },
            containers: [
              {
                name: 'peering-server',
                image,
                imagePullPolicy: 'IfNotPresent',
                ports: [
                  {
                    containerPort: port,
                    name: 'http',
                    protocol: 'TCP',
                  },
                ],
                env: [
                  {
                    name: 'PORT',
                    value: port.toString(),
                  },
                  {
                    name: 'CONFIG_PATH',
                    value: '/etc/peering/config.json',
                  },
                  {
                    name: 'POD_NAME',
                    valueFrom: {
                      fieldRef: {
                        fieldPath: 'metadata.name',
                      },
                    },
                  },
                  {
                    name: 'POD_NAMESPACE',
                    valueFrom: {
                      fieldRef: {
                        fieldPath: 'metadata.namespace',
                      },
                    },
                  },
                ],
                volumeMounts: [
                  {
                    name: 'config',
                    mountPath: '/etc/peering',
                    readOnly: true,
                  },
                ],
                // BONUS: Resource requests and limits for QoS
                resources,
                // BONUS: Security context for container
                securityContext: {
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                  runAsNonRoot: true,
                  runAsUser: 1001,
                  capabilities: {
                    drop: ['ALL'],
                  },
                },
                livenessProbe: {
                  httpGet: {
                    path: '/health',
                    port: port as any,
                  },
                  initialDelaySeconds: 10,
                  periodSeconds: 10,
                  timeoutSeconds: 5,
                  failureThreshold: 3,
                },
                readinessProbe: {
                  httpGet: {
                    path: '/health',
                    port: port as any,
                  },
                  initialDelaySeconds: 5,
                  periodSeconds: 5,
                  timeoutSeconds: 3,
                  failureThreshold: 3,
                },
              },
            ],
            volumes: [
              {
                name: 'config',
                configMap: {
                  name: `${name}-config`,
                },
              },
            ],
          },
        },
      },
    };
  }

  private async reconcile(peeringServer: PeeringServer): Promise<void> {
    const name = peeringServer.metadata.name!;
    const namespace = peeringServer.metadata.namespace || this.namespace;

    logger.info(`Reconciling PeeringServer: ${namespace}/${name}`);

    try {
      const port = peeringServer.spec.port || 8080;
      const replicas = peeringServer.spec.replicas;

      // Generate peer list
      const peers = this.generatePeerList(name, namespace, replicas, port);

      // Create or update ConfigMap
      const configMap = this.createConfigMap(peeringServer, peers);
      await this.createOrUpdateConfigMap(configMap);

      // Create or update Headless Service
      const service = this.createHeadlessService(peeringServer);
      await this.createOrUpdateService(service);

      // Create or update StatefulSet
      const statefulSet = this.createStatefulSet(peeringServer);
      await this.createOrUpdateStatefulSet(statefulSet);

      // Update status
      await this.updateStatus(peeringServer, 'Running');

      logger.info(`Successfully reconciled PeeringServer: ${namespace}/${name}`);
    } catch (error: any) {
      logger.error(`Error reconciling PeeringServer ${namespace}/${name}: ${error.message}`);
      await this.updateStatus(peeringServer, 'Failed');
    }
  }

  private async createOrUpdateConfigMap(configMap: k8s.V1ConfigMap): Promise<void> {
    const name = configMap.metadata!.name!;
    const namespace = configMap.metadata!.namespace!;

    try {
      await this.k8sApi.readNamespacedConfigMap(name, namespace);
      // ConfigMap exists, update it
      await this.k8sApi.replaceNamespacedConfigMap(name, namespace, configMap);
      logger.info(`Updated ConfigMap: ${namespace}/${name}`);
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        // ConfigMap doesn't exist, create it
        await this.k8sApi.createNamespacedConfigMap(namespace, configMap);
        logger.info(`Created ConfigMap: ${namespace}/${name}`);
      } else {
        throw error;
      }
    }
  }

  private async createOrUpdateService(service: k8s.V1Service): Promise<void> {
    const name = service.metadata!.name!;
    const namespace = service.metadata!.namespace!;

    try {
      const existing = await this.k8sApi.readNamespacedService(name, namespace);
      // Service exists, update it (preserve clusterIP)
      service.spec!.clusterIP = existing.body.spec!.clusterIP;
      await this.k8sApi.replaceNamespacedService(name, namespace, service);
      logger.info(`Updated Service: ${namespace}/${name}`);
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        // Service doesn't exist, create it
        await this.k8sApi.createNamespacedService(namespace, service);
        logger.info(`Created Service: ${namespace}/${name}`);
      } else {
        throw error;
      }
    }
  }

  private async createOrUpdateStatefulSet(statefulSet: k8s.V1StatefulSet): Promise<void> {
    const name = statefulSet.metadata!.name!;
    const namespace = statefulSet.metadata!.namespace!;

    try {
      await this.k8sAppsApi.readNamespacedStatefulSet(name, namespace);
      // StatefulSet exists, update it
      await this.k8sAppsApi.replaceNamespacedStatefulSet(name, namespace, statefulSet);
      logger.info(`Updated StatefulSet: ${namespace}/${name}`);
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        // StatefulSet doesn't exist, create it
        await this.k8sAppsApi.createNamespacedStatefulSet(namespace, statefulSet);
        logger.info(`Created StatefulSet: ${namespace}/${name}`);
      } else {
        throw error;
      }
    }
  }

  private async updateStatus(peeringServer: PeeringServer, phase: string): Promise<void> {
    const name = peeringServer.metadata.name!;
    const namespace = peeringServer.metadata.namespace || this.namespace;

    try {
      // Get current StatefulSet status
      const statefulSet = await this.k8sAppsApi.readNamespacedStatefulSet(name, namespace);
      const replicas = statefulSet.body.status?.replicas || 0;
      const readyReplicas = statefulSet.body.status?.readyReplicas || 0;

      const status: PeeringServerStatus = {
        replicas,
        readyReplicas,
        phase,
        lastUpdated: new Date().toISOString(),
      };

      await this.k8sCustomApi.patchNamespacedCustomObjectStatus(
        'luxor.io',
        'v1',
        namespace,
        'peeringservers',
        name,
        { status },
        undefined,
        undefined,
        undefined,
        { headers: { 'Content-Type': 'application/merge-patch+json' } }
      );

      logger.debug(`Updated status for PeeringServer: ${namespace}/${name}`);
    } catch (error: any) {
      logger.error(`Error updating status for ${namespace}/${name}: ${error.message}`);
    }
  }

  private async handleEvent(type: string, obj: any): Promise<void> {
    const peeringServer = obj as PeeringServer;
    const name = peeringServer.metadata.name;
    const namespace = peeringServer.metadata.namespace || this.namespace;

    logger.info(`Event: ${type} - PeeringServer: ${namespace}/${name}`);

    if (type === 'ADDED' || type === 'MODIFIED') {
      await this.reconcile(peeringServer);
    } else if (type === 'DELETED') {
      logger.info(`PeeringServer deleted: ${namespace}/${name} (resources will be cleaned up by owner references)`);
    }
  }

  private async syncExistingResources(): Promise<void> {
    logger.info('Syncing existing PeeringServer resources...');

    try {
      const response = await this.k8sCustomApi.listNamespacedCustomObject(
        'luxor.io',
        'v1',
        this.namespace,
        'peeringservers'
      );

      const items = (response.body as any).items || [];
      logger.info(`Found ${items.length} existing PeeringServer(s)`);

      for (const item of items) {
        await this.reconcile(item as PeeringServer);
      }

      logger.info('Initial sync complete');
    } catch (error: any) {
      logger.error(`Error syncing existing resources: ${error.message}`);
    }
  }

  public async start(): Promise<void> {
    logger.info('========================================');
    logger.info('Peering Server Operator Starting...');
    logger.info(`Watching namespace: ${this.namespace}`);
    logger.info('========================================');

    // Sync existing resources before starting watch
    await this.syncExistingResources();

    const path = `/apis/luxor.io/v1/namespaces/${this.namespace}/peeringservers`;

    logger.info(`Watch path: ${path}`);
    logger.info('Starting watch for new events...');

    while (true) {
      try {
        await this.watch.watch(
          path,
          {},
          (type: string, apiObj: any) => {
            this.handleEvent(type, apiObj).catch((error) => {
              logger.error(`Error handling event: ${error.message}`);
            });
          },
          (err: any) => {
            if (err) {
              logger.error(`Watch error: ${err.message}`);
            }
          }
        );
      } catch (error: any) {
        logger.error(`Watch crashed: ${error.message}`);
        logger.info('Restarting watch in 5 seconds...');
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
}

// Main execution
const operator = new PeeringServerOperator();
operator.start().catch((error) => {
  logger.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
