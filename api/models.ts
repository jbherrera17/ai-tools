import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireOwner } from './lib/auth.js';
import { groupedForUi, getDefaultHigginsModel } from './lib/modelCatalog.js';
import { getProviderKeyStatus } from './lib/gatewayByok.js';

/**
 * Higgins 2.0 model catalog — used by the chat picker.
 *
 *   GET /api/models  → { defaultModel, models: grouped, providers }
 *
 * `providers` is a boolean map of which BYOK keys are set. The UI still
 * shows every catalog group even when a key is missing — Gateway can
 * serve OSS models without BYOK, and BYOK-capable providers still work
 * via Gateway credits / OIDC.
 *
 * Node-style handler required by @vercel/node@3.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireOwner(req, res)) return;

  res.status(200).json({
    defaultModel: getDefaultHigginsModel(),
    models: groupedForUi(),
    providers: getProviderKeyStatus(),
  });
}
