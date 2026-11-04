import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createHandler } from './app.ts';
import { loadConfig } from './config.ts';
import type { MarketProvider, NewsProvider } from './domain.ts';
import { MockNewsProvider, NaverNewsProvider } from './news.ts';
import { LiveProvider } from './providers/live.ts';
import { MockProvider } from './providers/mock.ts';
import { TossClient } from './toss/client.ts';

const config = loadConfig();

const provider: MarketProvider =
  config.mode === 'live'
    ? new LiveProvider(
        new TossClient({ baseUrl: config.toss.baseUrl, clientId: config.toss.clientId, clientSecret: config.toss.clientSecret }),
        config.toss.accountSeq,
      )
    : new MockProvider();

const news: NewsProvider =
  config.news.naverClientId && config.news.naverClientSecret
    ? new NaverNewsProvider(config.news.naverClientId, config.news.naverClientSecret)
    : new MockNewsProvider();

if (config.staticDir) config.staticDir = resolve(config.staticDir);

createServer(createHandler({ config, provider, news })).listen(config.port, () => {
  console.log(
    `[server] :${config.port}  mode=${provider.kind}  news=${news.kind}  trading=${
      provider.kind === 'mock' || config.trading.enabled ? 'ON' : 'OFF'
    }  auth=${config.deviceToken ? 'device-token' : 'none'}`,
  );
});
