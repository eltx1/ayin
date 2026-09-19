import { runMuxTask72ControlPlaneProof } from "./mux-live-provider-proof.js";

const result = await runMuxTask72ControlPlaneProof(process.env);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.status !== "VERIFIED") {
  process.stdout.write(
    "Task 72 live proof did not make a network call. Set MUX_TOKEN_ID, MUX_TOKEN_SECRET, and MUX_TASK72_PROOF=1 to run the provider test-mode control-plane proof.\n",
  );
}
