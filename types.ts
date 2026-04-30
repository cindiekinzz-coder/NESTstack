/**
 * Shared types for NESTstack carrier modules.
 *
 * Each top-level product folder (NESTchat, NESTknow, NESTsoul, ...) is
 * consumed two ways:
 *
 *  - by upstream NESTeq, which has a richer worker Env (R2, secrets,
 *    additional bindings). NESTeq imports module handlers from these
 *    folders directly, passing its own Env where structural typing
 *    accepts it.
 *
 *  - by carriers / downstream forks, who satisfy this minimal interface
 *    from their own bindings and copy or import the module file into
 *    their worker.
 *
 * The Env declared here is intentionally narrow — it names only what
 * the cross-cutting modules actually use (D1, Workers AI, Vectorize).
 * Any worker that exposes these bindings can drop these modules in.
 *
 * Cloudflare globals (D1Database, Ai, VectorizeIndex) are expected to
 * be provided by the consuming project's tsconfig via
 * @cloudflare/workers-types or equivalent.
 */

export interface Env {
  DB: D1Database;
  AI: Ai;
  VECTORS: VectorizeIndex;
}
