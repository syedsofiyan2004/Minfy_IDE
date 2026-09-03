import { BedrockClient } from '@aws-sdk/client-bedrock';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { STSClient } from '@aws-sdk/client-sts';
import { bedrockConfigService } from './bedrockConfigService.js';

export interface BedrockClientsBundle {
  bedrockClient?: any;
  runtimeClient?: any;
  stsClient?: any;
}

export class BedrockClientFactory {
  private bedrockClients = new Map<string, BedrockClient>();
  private runtimeClients = new Map<string, BedrockRuntimeClient>();
  private stsClients = new Map<string, STSClient>();

  // Mock bundle for isolated unit testing
  private mockBundle: BedrockClientsBundle | null = null;

  constructor() {
    // Invalidate client caches whenever configuration changes
    bedrockConfigService.onConfigChange(() => {
      this.invalidateClients();
    });
  }

  public setMockClients(bundle: BedrockClientsBundle | null): void {
    this.mockBundle = bundle;
    this.invalidateClients();
  }

  public invalidateClients(): void {
    for (const client of this.bedrockClients.values()) {
      try {
        client.destroy();
      } catch {}
    }
    for (const client of this.runtimeClients.values()) {
      try {
        client.destroy();
      } catch {}
    }
    for (const client of this.stsClients.values()) {
      try {
        client.destroy();
      } catch {}
    }
    this.bedrockClients.clear();
    this.runtimeClients.clear();
    this.stsClients.clear();
  }

  private getCacheKey(region?: string, profile?: string): string {
    return `${(region || '').trim().toLowerCase()}:${(profile || '').trim()}`;
  }

  public getBedrockClient(region?: string, profile?: string): BedrockClient {
    if (this.mockBundle?.bedrockClient) {
      return this.mockBundle.bedrockClient;
    }

    const key = this.getCacheKey(region, profile);
    let client = this.bedrockClients.get(key);
    if (!client) {
      const config: any = {};
      if (region) config.region = region;
      if (profile) config.profile = profile;
      client = new BedrockClient(config);
      this.bedrockClients.set(key, client);
    }
    return client;
  }

  public getBedrockRuntimeClient(region?: string, profile?: string): BedrockRuntimeClient {
    if (this.mockBundle?.runtimeClient) {
      return this.mockBundle.runtimeClient;
    }

    const key = this.getCacheKey(region, profile);
    let client = this.runtimeClients.get(key);
    if (!client) {
      const config: any = {};
      if (region) config.region = region;
      if (profile) config.profile = profile;
      client = new BedrockRuntimeClient(config);
      this.runtimeClients.set(key, client);
    }
    return client;
  }

  public getSTSClient(region?: string, profile?: string): STSClient {
    if (this.mockBundle?.stsClient) {
      return this.mockBundle.stsClient;
    }

    const key = this.getCacheKey(region, profile);
    let client = this.stsClients.get(key);
    if (!client) {
      const config: any = {};
      if (region) config.region = region;
      if (profile) config.profile = profile;
      client = new STSClient(config);
      this.stsClients.set(key, client);
    }
    return client;
  }
}

export const bedrockClientFactory = new BedrockClientFactory();
