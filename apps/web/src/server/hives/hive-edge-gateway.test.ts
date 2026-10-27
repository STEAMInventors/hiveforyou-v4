import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  handleV1HivesRequest,
  mapRpcFailure,
  type EdgeUserSupabaseClient,
} from "../../../../../supabase/functions/v1-hives/handler";
import {
  createHiveViaEdge,
  getHiveViaEdge,
  listHivesViaEdge,
  type EdgeSupabaseClient,
} from "./hive-edge-gateway";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQ_1 = "11111111-1111-4111-8111-111111111111";
const REQ_2 = "22222222-2222-4222-8222-222222222222";
const CORR_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";

type StoredHiveRow = {
  id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  client_request_id: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

/**
 * Simulates the exact PostgreSQL `hive.hives` table + owner RLS + SECURITY INVOKER RPCs
 * (`public.list_hives`, `public.get_hive`, `public.get_hive_by_client_request_id`, `public.create_hive`)
 * defined in `supabase/migrations/20261027090000_create_hive_schema.sql`.
 */
function createSimulatedDatabase() {
  const rows: StoredHiveRow[] = [];

  function rpcForUser(userId: string | null) {
    return async (
      fn: string,
      args: Record<string, unknown> = {},
    ): Promise<{ data: unknown; error: unknown }> => {
      if (!userId) {
        return {
          data: null,
          error: { code: "42501", message: "auth_required" },
        };
      }

      if (fn === "list_hives") {
        const owned = rows
          .filter((r) => r.owner_user_id === userId && r.archived_at === null)
          .map((r) => ({
            id: r.id,
            hiveId: r.id,
            name: r.name,
            description: r.description,
            clientRequestId: r.client_request_id,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          }));
        return { data: owned, error: null };
      }

      if (fn === "get_hive") {
        const hiveId = args.p_hive_id;
        if (typeof hiveId !== "string" || !hiveId) {
          return {
            data: null,
            error: {
              code: "22023",
              message: "invalid_request:hive_id_required",
            },
          };
        }
        const found = rows.find(
          (r) =>
            r.id === hiveId &&
            r.owner_user_id === userId &&
            r.archived_at === null,
        );
        if (!found) {
          return { data: null, error: null };
        }
        return {
          data: {
            id: found.id,
            hiveId: found.id,
            name: found.name,
            description: found.description,
            clientRequestId: found.client_request_id,
            createdAt: found.created_at,
            updatedAt: found.updated_at,
          },
          error: null,
        };
      }

      if (fn === "get_hive_by_client_request_id") {
        const reqId = args.p_client_request_id;
        if (typeof reqId !== "string" || !reqId) {
          return {
            data: null,
            error: {
              code: "22023",
              message: "invalid_request:client_request_id_required",
            },
          };
        }
        const found = rows.find(
          (r) =>
            r.client_request_id === reqId &&
            r.owner_user_id === userId &&
            r.archived_at === null,
        );
        if (!found) {
          return { data: null, error: null };
        }
        return {
          data: {
            id: found.id,
            hiveId: found.id,
            name: found.name,
            description: found.description,
            clientRequestId: found.client_request_id,
            createdAt: found.created_at,
            updatedAt: found.updated_at,
          },
          error: null,
        };
      }

      if (fn === "create_hive") {
        const rawName =
          typeof args.p_name === "string" ? args.p_name : "";
        const rawDesc =
          typeof args.p_description === "string" ? args.p_description : null;
        const reqId =
          typeof args.p_client_request_id === "string"
            ? args.p_client_request_id
            : "";

        const trimmedName = rawName.trim();
        const trimmedDesc =
          rawDesc === null || rawDesc.trim() === "" ? null : rawDesc.trim();

        if (!reqId) {
          return {
            data: null,
            error: {
              code: "22023",
              message: "invalid_request:client_request_id_required",
            },
          };
        }
        if (trimmedName.length < 1) {
          return {
            data: null,
            error: { code: "22023", message: "invalid_request:name_required" },
          };
        }
        if (trimmedName.length > 100) {
          return {
            data: null,
            error: { code: "22023", message: "invalid_request:name_too_long" },
          };
        }
        if (trimmedDesc !== null && trimmedDesc.length > 500) {
          return {
            data: null,
            error: {
              code: "22023",
              message: "invalid_request:description_too_long",
            },
          };
        }

        const existing = rows.find(
          (r) =>
            r.owner_user_id === userId &&
            r.client_request_id === reqId &&
            r.archived_at === null,
        );

        if (existing) {
          if (
            existing.name !== trimmedName ||
            existing.description !== trimmedDesc
          ) {
            return {
              data: null,
              error: {
                code: "23505",
                message: "idempotency_conflict",
              },
            };
          }
          return {
            data: {
              hive: {
                id: existing.id,
                hiveId: existing.id,
                name: existing.name,
                description: existing.description,
                clientRequestId: existing.client_request_id,
                createdAt: existing.created_at,
                updatedAt: existing.updated_at,
              },
              created: false,
            },
            error: null,
          };
        }

        const now = "2026-10-26T21:00:00.000Z";
        const inserted: StoredHiveRow = {
          id: crypto.randomUUID(),
          owner_user_id: userId,
          name: trimmedName,
          description: trimmedDesc,
          client_request_id: reqId,
          created_at: now,
          updated_at: now,
          archived_at: null,
        };
        rows.push(inserted);

        return {
          data: {
            hive: {
              id: inserted.id,
              hiveId: inserted.id,
              name: inserted.name,
              description: inserted.description,
              clientRequestId: inserted.client_request_id,
              createdAt: inserted.created_at,
              updatedAt: inserted.updated_at,
            },
            created: true,
          },
          error: null,
        };
      }

      return {
        data: null,
        error: { code: "42883", message: "unknown_rpc" },
      };
    };
  }

  function makeEdgeGatewayClient(userId: string | null): EdgeSupabaseClient {
    const createUserClient = (authHeader: string): EdgeUserSupabaseClient => {
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      const resolvedUser =
        token === "token-user-a"
          ? USER_A
          : token === "token-user-b"
            ? USER_B
            : null;
      return {
        auth: {
          getUser: async () => ({
            data: { user: resolvedUser ? { id: resolvedUser } : null },
            error: resolvedUser ? null : { message: "invalid_jwt" },
          }),
        },
        rpc: rpcForUser(resolvedUser),
      };
    };

    const accessToken =
      userId === USER_A
        ? "token-user-a"
        : userId === USER_B
          ? "token-user-b"
          : null;

    return {
      auth: {
        getSession: vi.fn(async () => ({
          data: {
            session: accessToken ? { access_token: accessToken } : null,
          },
          error: null,
        })),
      } as unknown as EdgeSupabaseClient["auth"],
      functions: {
        invoke: vi.fn(
          async (
            _fnName: string,
            options?: {
              body?: unknown;
              headers?: Record<string, string>;
            },
          ) => {
            const req = new Request("https://edge.local/functions/v1/v1-hives", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(options?.headers ?? {}),
              },
              body: JSON.stringify(options?.body ?? {}),
            });
            const response = await handleV1HivesRequest(req, createUserClient);
            const payload = await response.json();
            if (!response.ok) {
              return {
                data: null,
                error: {
                  message: "Edge Function returned a non-2xx status code",
                  context: { body: payload },
                },
              };
            }
            return { data: payload, error: null };
          },
        ),
      } as unknown as EdgeSupabaseClient["functions"],
    };
  }

  return { rows, rpcForUser, makeEdgeGatewayClient };
}

describe("V4-002 Hive Edge Function + RPC + Gateway architecture", () => {
  it("enforces owner isolation between User A and User B across Edge Function and direct RPC calls", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const db = createSimulatedDatabase();
      const clientA = db.makeEdgeGatewayClient(USER_A);
      const clientB = db.makeEdgeGatewayClient(USER_B);

      const created = await createHiveViaEdge(
        clientA,
        {
          name: "Private Medical Records",
          description: "Confidential notes",
          clientRequestId: REQ_1,
        },
        CORR_ID,
      );

      expect(created.created).toBe(true);
      expect(created.hive.name).toBe("Private Medical Records");

      const listA = await listHivesViaEdge(clientA, CORR_ID);
      expect(listA.hives).toHaveLength(1);
      expect(listA.hives[0]?.id).toBe(created.hive.id);

      const listB = await listHivesViaEdge(clientB, CORR_ID);
      expect(listB.hives).toHaveLength(0);

      await expect(
        getHiveViaEdge(clientB, created.hive.id, CORR_ID),
      ).rejects.toMatchObject({
        errorCode: "NOT_FOUND",
        category: "SECURITY",
        retryable: false,
      });

      // Direct RPC call by User B also returns null (0 rows visible)
      const directRpcB = db.rpcForUser(USER_B);
      const directGetB = await directRpcB("get_hive", {
        p_hive_id: created.hive.id,
      });
      expect(directGetB.data).toBeNull();

      // Verify logs do not contain Hive name or description
      const logs = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logs).not.toContain("Private Medical Records");
      expect(logs).not.toContain("Confidential notes");
      expect(logs).not.toContain("token-user-a");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("handles concurrent creation and normalized-payload idempotent replay atomically", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const db = createSimulatedDatabase();
      const clientA = db.makeEdgeGatewayClient(USER_A);

      const [first, second] = await Promise.all([
        createHiveViaEdge(
          clientA,
          {
            name: "  Maya's IEP  ",
            description: "   ",
            clientRequestId: REQ_1,
          },
          CORR_ID,
        ),
        createHiveViaEdge(
          clientA,
          {
            name: "Maya's IEP",
            description: null,
            clientRequestId: REQ_1,
          },
          CORR_ID,
        ),
      ]);

      expect(db.rows).toHaveLength(1);
      expect(first.hive.id).toBe(second.hive.id);
      expect([first.created, second.created].sort()).toEqual([false, true]);

      // Different User B using the same clientRequestId gets their own independent Hive
      const clientB = db.makeEdgeGatewayClient(USER_B);
      const userBResult = await createHiveViaEdge(
        clientB,
        {
          name: "User B Workspace",
          description: null,
          clientRequestId: REQ_1,
        },
        CORR_ID,
      );
      expect(userBResult.created).toBe(true);
      expect(userBResult.hive.id).not.toBe(first.hive.id);
      expect(db.rows).toHaveLength(2);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("maps idempotency conflicts to 409 IDEMPOTENCY_CONFLICT without treating unrelated 23505 errors as the same error", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const db = createSimulatedDatabase();
      const clientA = db.makeEdgeGatewayClient(USER_A);

      await createHiveViaEdge(
        clientA,
        {
          name: "Original Name",
          description: "Original description",
          clientRequestId: REQ_2,
        },
        CORR_ID,
      );

      await expect(
        createHiveViaEdge(
          clientA,
          {
            name: "Different Name",
            description: "Original description",
            clientRequestId: REQ_2,
          },
          CORR_ID,
        ),
      ).rejects.toMatchObject({
        errorCode: "IDEMPOTENCY_CONFLICT",
        category: "PERSISTENCE",
        retryable: false,
      });

      // Unrelated 23505 uniqueness error must map to PERSISTENCE_FAILED (503), not IDEMPOTENCY_CONFLICT
      const unrelatedUnique = mapRpcFailure({
        code: "23505",
        message: 'duplicate key value violates unique constraint "pk_hives"',
      });
      expect(unrelatedUnique.errorCode).toBe("PERSISTENCE_FAILED");
      expect(unrelatedUnique.status).toBe(503);
      expect(unrelatedUnique.diagnosticReason).toBe("unique_violation");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("enforces validation and auth directly at the RPC boundary even when Edge validation is bypassed", async () => {
    const db = createSimulatedDatabase();

    // Unauthenticated direct RPC call
    const unauthRpc = db.rpcForUser(null);
    const unauthRes = await unauthRpc("list_hives");
    expect(mapRpcFailure(unauthRes.error).errorCode).toBe("UNAUTHENTICATED");

    // Authenticated direct RPC call with invalid inputs
    const userRpc = db.rpcForUser(USER_A);
    const emptyName = await userRpc("create_hive", {
      p_name: "   ",
      p_description: null,
      p_client_request_id: REQ_1,
    });
    expect(mapRpcFailure(emptyName.error).errorCode).toBe("INVALID_REQUEST");

    const longName = await userRpc("create_hive", {
      p_name: "x".repeat(101),
      p_description: null,
      p_client_request_id: REQ_1,
    });
    expect(mapRpcFailure(longName.error).errorCode).toBe("INVALID_REQUEST");

    const longDesc = await userRpc("create_hive", {
      p_name: "Valid",
      p_description: "y".repeat(501),
      p_client_request_id: REQ_1,
    });
    expect(mapRpcFailure(longDesc.error).errorCode).toBe("INVALID_REQUEST");
  });

  it("performs bounded retry on transient Edge timeout and succeeds on second attempt", async () => {
    let calls = 0;
    const client: EdgeSupabaseClient = {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "token-user-a" } },
          error: null,
        })),
      } as unknown as EdgeSupabaseClient["auth"],
      functions: {
        invoke: vi.fn(async () => {
          calls += 1;
          if (calls === 1) {
            const err = new Error("edge_invoke_timeout");
            err.name = "AbortError";
            throw err;
          }
          return {
            data: {
              hives: [
                {
                  id: REQ_1,
                  hiveId: REQ_1,
                  name: "Recovered Hive",
                  description: null,
                  clientRequestId: REQ_2,
                  createdAt: "2026-10-26T21:00:00Z",
                  updatedAt: "2026-10-26T21:00:00Z",
                },
              ],
            },
            error: null,
          };
        }),
      } as unknown as EdgeSupabaseClient["functions"],
    };

    const result = await listHivesViaEdge(client, CORR_ID);
    expect(calls).toBe(2);
    expect(result.hives).toHaveLength(1);
    expect(result.hives[0]?.name).toBe("Recovered Hive");
  });

  it("verifies migration SQL grants only SELECT and INSERT on hive.hives and does not expose hive schema in config.toml", async () => {
    const repoRoot = path.resolve(process.cwd(), "../..");
    const sql = await readFile(
      path.join(
        repoRoot,
        "supabase/migrations/20261027090000_create_hive_schema.sql",
      ),
      "utf8",
    );
    const configToml = await readFile(
      path.join(repoRoot, "supabase/config.toml"),
      "utf8",
    );

    expect(sql).toContain("GRANT SELECT, INSERT ON hive.hives TO authenticated;");
    expect(sql).not.toMatch(/GRANT[^;]*UPDATE[^;]*ON\s+hive\.hives/i);
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*ON\s+hive\.hives/i);
    expect(sql).toContain("ALTER TABLE hive.hives ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("ALTER TABLE hive.hives FORCE ROW LEVEL SECURITY;");
    expect(sql).toContain("SECURITY INVOKER");
    expect(configToml).toContain('schemas = ["public", "graphql_public"]');
    expect(configToml).toContain("verify_jwt = true");
  });
});
