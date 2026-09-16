import type {
  AyinLensEmbeddingProvider,
  EmbeddingInput,
  EmbeddingOutput,
  EmbeddingProviderInfo,
  EmbeddingPurpose,
} from "./lens-search.provider.js";

/** Test-only adapter. It is never registered by SearchModule in production. */
export class DeterministicLensTestEmbeddingProvider implements AyinLensEmbeddingProvider {
  readonly calls: Array<{ purpose: EmbeddingPurpose; inputs: readonly EmbeddingInput[] }> = [];

  constructor(
    private readonly vectors: ReadonlyMap<string, number[]>,
    private readonly metadata: EmbeddingProviderInfo = {
      providerKey: "test",
      model: "fixture",
      modelVersion: "v1",
      dimensions: 3,
    },
  ) {}

  isConfigured() {
    return true;
  }

  info() {
    return this.metadata;
  }

  async embed(
    inputs: readonly EmbeddingInput[],
    purpose: EmbeddingPurpose,
  ): Promise<EmbeddingOutput[]> {
    this.calls.push({ purpose, inputs });
    return inputs.map((input) => {
      const values = this.vectors.get(input.text) ?? this.vectors.get(input.key);
      if (!values) throw new Error(`Missing deterministic test vector for ${input.key}.`);
      return { key: input.key, values: [...values] };
    });
  }
}
