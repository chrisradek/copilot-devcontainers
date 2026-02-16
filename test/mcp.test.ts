import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.js";

describe("MCP Server", () => {
  it("should start and list tools", async () => {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);

    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain("sandbox_up");
    expect(toolNames).toContain("sandbox_exec");
    expect(toolNames).toContain("sandbox_down");
    expect(toolNames).toContain("sandbox_merge");
    expect(toolNames).toContain("sandbox_list");
    expect(toolNames).toContain("sandbox_diff");
    expect(toolNames).toContain("sandbox_cleanup");
    expect(toolNames).toContain("generate_session_id");
    expect(toolNames).toContain("orchestration_create");
    expect(toolNames).toContain("orchestration_list");
    expect(toolNames).toContain("task_create");
    expect(toolNames).toContain("task_update");
    expect(toolNames).toContain("task_list");
    expect(toolNames).toContain("task_get");
    expect(toolNames).toContain("issue_create");
    expect(toolNames).toContain("issue_list");
    expect(toolNames).toContain("issue_get");
    expect(toolNames).toContain("issue_update");
    expect(toolNames).toContain("issue_import");

    await client.close();
    await server.close();
  });

  it("should generate session IDs", async () => {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);

    const result = await client.callTool({ name: "generate_session_id", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    await client.close();
    await server.close();
  });
});
