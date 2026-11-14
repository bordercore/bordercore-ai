import type { ModelInfo } from "../stores/ChatStoreContext";

export function getModelService(model: ModelInfo): string {
  if (model.served_by?.trim()) return model.served_by.trim();
  if (model.vllm_profile) return "vLLM";
  if (model.llama_cpp_profile) return "llama.cpp";
  if (model.vendor === "openrouter") return "OpenRouter";
  return model.type === "api" ? "API" : "Local";
}

export function groupModels(models: ModelInfo[], query = "") {
  const groups = new Map<string, ModelInfo[]>();
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  // Build groups before filtering so searching never changes provider order.
  for (const model of models) {
    const provider = model.provider?.trim() || "Other";
    if (!groups.has(provider)) groups.set(provider, []);
    const searchable = [provider, model.name, model.model, getModelService(model)]
      .join(" ")
      .toLowerCase();
    if (terms.every(term => searchable.includes(term))) {
      groups.get(provider)!.push(model);
    }
  }

  const other = groups.get("Other");
  groups.delete("Other");
  if (other) groups.set("Other", other);
  return Array.from(groups, ([provider, models]) => ({ provider, models })).filter(
    group => group.models.length > 0
  );
}
