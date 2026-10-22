import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { createPaseoApi } from '@getpaseo/client';

const PRODUCTION_LISTEN = '127.0.0.1:6767';

/** Connect to the disposable test daemon named by WORKBENCH_TEST_DAEMON. Refuses the default production listen address. */
export async function connect() {
  const target = process.env.WORKBENCH_TEST_DAEMON;
  if (!target) throw new Error('Set WORKBENCH_TEST_DAEMON=127.0.0.1:<port> of a disposable `paseo daemon run --home <tmp>` daemon.');
  if (target === PRODUCTION_LISTEN || target === `localhost:6767`) throw new Error('Refusing to run integration tests against the default production daemon.');
  const daemon = new DaemonClient({ url: `ws://${target}/ws`, clientId: `workbench-it-${process.pid}`, clientType: 'cli', reconnect: { enabled: false } });
  await daemon.connect();
  const paseo = createPaseoApi(daemon);
  return { daemon, paseo, close: async () => { await paseo.dispose().catch(() => {}); await daemon.close(); } };
}
