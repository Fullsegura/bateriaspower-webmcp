/// <reference types="webmcp-types" />

declare namespace WebMCP {
  interface ModelContextExecuteToolOptions {
    signal?: AbortSignal;
  }

  interface ModelContext {
    executeTool(
      tool: RegisteredTool,
      input: string,
      options?: ModelContextExecuteToolOptions,
    ): Promise<unknown>;
  }
}
