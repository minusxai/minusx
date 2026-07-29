import 'server-only';

/**
 * Registering a new workspace with the MinusX gateway.
 *
 * Runs at the tail of `AuthModule.register`, and only when `MX_GATEWAY_URL` and
 * `MX_GATEWAY_SHARED_SECRET` are both set. Otherwise nothing here touches the
 * network at all.
 *
 * BEST EFFORT BY DESIGN. Registration has already committed by the time this
 * runs, so nothing in here may throw: an outage must leave a working workspace
 * whose admin configures a provider by hand, not a half-registered one that
 * cannot be registered again.
 */

import { DEFAULT_MODE } from '@/lib/mode/mode-types';
import { getRawConfig, saveRawConfig } from '@/lib/data/configs.server';

import { createGatewayOrg, buildGatewayLlmConfig, gatewayEnabled } from './gateway-client.server';
import { GATEWAY_CONFIG_KEY, type GatewayCredentials } from './gateway-types';

/**
 * Register, then persist the credentials as this workspace's LLM provider.
 *
 * Returns the credentials on success, `null` when the gateway is disabled or
 * unreachable. Both secrets are written into the config document, where
 * extract-on-write moves them into the secrets store as `@SECRETS/…` refs —
 * they are returned exactly once and cannot be re-read.
 */
export async function registerCompanyWithGateway(
  input: { email: string; workspaceName: string },
): Promise<GatewayCredentials | null> {
  if (!gatewayEnabled()) return null;

  try {
    const creds = await createGatewayOrg(input);
    if (!creds) {
      // Loud, because everything downstream of this is a non-event: no gateway
      // config is written, so the models provider falls back to whatever else
      // is configured and the settings panel shows nothing. Without this line
      // that reads as "the feature is broken" rather than "registration was
      // refused, and here is why".
      console.warn(
        `[gateway] NOT registered for workspace '${input.workspaceName}' — see the ` +
        `error above. This workspace will use whatever LLM provider is configured ` +
        `by other means, and Settings will show no plan.`,
      );
      return null;
    }

    const raw = await getRawConfig(DEFAULT_MODE);
    await saveRawConfig(DEFAULT_MODE, {
      ...raw,
      // `orgId`/`keyId` are public ids, safe to keep in the document; the two
      // secrets are extracted into the secrets store on write.
      [GATEWAY_CONFIG_KEY]: {
        orgId: creds.orgId,
        keyId: creds.keyId,
        orgSecret: creds.orgSecret,
      },
      // The workspace is immediately usable: every grade points at the
      // gateway, which picks the actual model from the routing headers.
      llm: buildGatewayLlmConfig(creds.key),
    });

    console.log(`[gateway] registered ${creds.orgId} for workspace '${input.workspaceName}'`);
    return creds;
  } catch (err) {
    console.warn('[gateway] company registration failed (non-fatal):', err);
    return null;
  }
}
