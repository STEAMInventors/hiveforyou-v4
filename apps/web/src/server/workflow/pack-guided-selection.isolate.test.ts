import { describe, expect, it } from "vitest";

import { isPackGuidedRebuild, PACK_GUIDED_STUDY_ENGINE_ID } from "./pack-guided-selection";

/**
 * Runs only in a child process spawned by pack-guided-selection.process.test.ts.
 * That process does not share the request process's in-memory selection.
 */
const enabled = process.env.PACK_GUIDED_ISOLATE === "1";

describe.skipIf(!enabled)("pack-guided worker process", () => {
  it("selects the engine stored on the run and not a process-local memory set", () => {
    const runId = process.env.PACK_GUIDED_RUN_ID ?? "";
    const outputs = JSON.parse(process.env.PACK_GUIDED_OUTPUTS ?? "{}") as {
      domainPack?: { engine?: string; investigationWindows?: { schema?: string; windows?: { status?: string }[] } };
    };
    expect(isPackGuidedRebuild(runId)).toBe(false);
    expect(isPackGuidedRebuild(runId, outputs)).toBe(true);
    expect(outputs.domainPack?.engine).toBe(PACK_GUIDED_STUDY_ENGINE_ID);
    expect(outputs.domainPack?.investigationWindows?.schema).toBe("hive.investigation-window-progress/1");
    expect(outputs.domainPack?.investigationWindows?.windows?.[0]?.status).toBe("complete");
  });
});
