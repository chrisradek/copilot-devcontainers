import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createIssueMcpServer } from "../src/issue-mcp.js";

describe("Issue MCP Server", () => {
  it("should start and list only issue tools", async () => {
    const server = createIssueMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    expect(tools.length).toBe(5);

    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain("issue_create");
    expect(toolNames).toContain("issue_list");
    expect(toolNames).toContain("issue_get");
    expect(toolNames).toContain("issue_update");
    expect(toolNames).toContain("issue_import");

    await client.close();
    await server.close();
  });
});
