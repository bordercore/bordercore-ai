import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../stores/ChatStoreContext";
import { getModelService, groupModels } from "./modelGroups";

const models: ModelInfo[] = [
  { model: "discovered.gguf", name: "Discovered" },
  {
    model: "gpt-sol",
    name: "Sol",
    provider: "OpenAI",
    vendor: "openai",
    type: "api",
    served_by: "CLIProxy",
  },
  {
    model: "claude-opus",
    name: "Opus",
    provider: "Anthropic",
    vendor: "openai",
    type: "api",
    served_by: "CLIProxy",
  },
  {
    model: "gpt-oss",
    name: "GPT-OSS",
    provider: "OpenAI",
    vendor: "openai",
    type: "api",
    vllm_profile: "gpt-oss",
  },
  { model: "gemma", name: "Gemma", provider: "Google", type: "api", llama_cpp_profile: "gemma" },
  {
    model: "deepseek/flash",
    name: "Flash",
    provider: "DeepSeek",
    vendor: "openrouter",
    type: "api",
  },
];

describe("model picker groups", () => {
  it("groups by maker rather than API client, preserves order, and puts unknowns last", () => {
    expect(
      groupModels(models).map(group => [group.provider, group.models.map(m => m.model)])
    ).toEqual([
      ["OpenAI", ["gpt-sol", "gpt-oss"]],
      ["Anthropic", ["claude-opus"]],
      ["Google", ["gemma"]],
      ["DeepSeek", ["deepseek/flash"]],
      ["Other", ["discovered.gguf"]],
    ]);
  });

  it("searches provider, name, ID, and serving method without changing IDs", () => {
    expect(groupModels(models, " ANTHROPIC cliproxy ")[0].models).toEqual([models[2]]);
    expect(groupModels(models, "gpt-oss")[0].models).toEqual([models[3]]);
    expect(groupModels(models, "openrouter")[0].models).toEqual([models[5]]);
    expect(groupModels(models, "missing")).toEqual([]);
    expect(groupModels([], "")).toEqual([]);
  });

  it("retains provider order when a provider's first model is filtered out", () => {
    const entries = models.map(model => ({
      ...model,
      name: model.model === "gpt-sol" ? "Hidden" : "Match",
    }));
    expect(groupModels(entries, "Match").map(group => group.provider)).toEqual([
      "OpenAI",
      "Anthropic",
      "Google",
      "DeepSeek",
      "Other",
    ]);
  });

  it("keeps local and proxied variants distinguishable", () => {
    expect(models.map(getModelService)).toEqual([
      "Local",
      "CLIProxy",
      "CLIProxy",
      "vLLM",
      "llama.cpp",
      "OpenRouter",
    ]);
    expect(getModelService({ name: "Direct", type: "api", vendor: "openai" })).toBe("API");
    expect(groupModels([{ name: "Unknown", provider: "  " }])[0].provider).toBe("Other");
  });
});
