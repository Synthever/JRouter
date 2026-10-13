import { canManageApiKeys } from "@/lib/apiKeyPolicy/dashboardAuth.js";
import { getModelsAliases, createModelsAlias } from "@/lib/db/repos/modelsAliasesRepo.js";
import { AliasComboNameConflict } from "@/lib/db/helpers/modelsAliasesNamespace.js";
import { normalizeModelsAliasConfig } from "@/lib/modelsAliases/config.js";
import { invalidateModelsAliasRuntime } from "@/sse/services/modelsAliasRuntime.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { getExecutorOutputObservability } from "open-sse/executors/index.js";
import { getProviderNodes } from "@/lib/db/repos/nodesRepo.js";
import { resolveAliasMembersFromContext } from "@/lib/modelsAliases/members.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    if (!(await canManageApiKeys(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const aliases = await getModelsAliases();
    // Validate provider identities only, independently of any particular model/account.
    const context = { providerNodes: await getProviderNodes(), providerConnections: [], customModels: [] };
    const providerMetadata = Object.create(null);
    for (const entry of REGISTRY) {
      if (!(entry.serviceKinds || entry.media?.serviceKinds || ["llm"]).includes("llm") || !(entry.transport || entry.transports)) continue;
      const metadata = { outputObservability: getExecutorOutputObservability(entry.id) };
      for (const prefix of [entry.id, entry.alias, ...(entry.aliases || [])].filter(Boolean)) providerMetadata[prefix] = metadata;
    }
    for (const node of context.providerNodes) {
      for (const prefix of [node.id, node.prefix].filter(Boolean)) {
        if (Object.hasOwn(providerMetadata, prefix)) continue;
        // Reuse member identity validation; a prefix collision must never overwrite a registered provider.
        try {
          const [member] = resolveAliasMembersFromContext([`${prefix}/metadata-fixture`], context);
          if (member.provider === node.id) providerMetadata[prefix] = { outputObservability: getExecutorOutputObservability(node.id) };
        } catch { /* Invalid, ambiguous or non-LLM node identity is not selectable. */ }
      }
    }
    return Response.json({ aliases, providerMetadata });
  } catch {
    return Response.json({ error: "Failed to fetch Models Aliases" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!(await canManageApiKeys(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json().catch(() => null);
    let config;
    try {
      config = normalizeModelsAliasConfig(body);
    } catch {
      return Response.json({ error: "Invalid Models Alias configuration" }, { status: 400 });
    }
    const alias = await createModelsAlias(config);
    invalidateModelsAliasRuntime(alias.id);
    return Response.json(alias, { status: 201 });
  } catch (error) {
    if (error instanceof AliasComboNameConflict) return Response.json({ error: "Models Alias or Combo name already exists", code: error.code }, { status: 409 });
    if (/^(Ambiguous provider prefix: |Unknown configured provider: |Member is not an LLM (provider|model): |Invalid compatible provider identity: |Provider is not configured: |Unknown LLM model: |Models Alias members changed during validation;)/.test(error?.message || "")) {
      return Response.json({ error: "Models Alias members are invalid or unavailable" }, { status: 400 });
    }
    return Response.json({ error: "Failed to create Models Alias" }, { status: 500 });
  }
}
