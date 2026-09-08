<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Agent decision boundary

- Do not add hardcoded conversational or business-decision rules outside the model to fix individual cases.
- Semantic decisions, clarifications, recommendations, and response wording belong in the ADK agent instructions and must be evaluated with representative datasets.
- Before calling any tool, the model must obtain every input required by `inputSchema.required` and any conditional requirement documented by that tool. Required values must come from the user or verified current context; they must not be guessed, inferred through case-specific code, or silently defaulted.
- If a required tool input is missing, the model must return a clarification question requesting only the missing input instead of calling the tool.
- Backend and frontend code may validate schemas, security, permissions, and technical invariants, and may perform deterministic calculations or state updates. It must not infer intent or rewrite, block, replace, or synthesize the model response based on case-specific logic.
- Do not fix a failed conversational evaluation by adding keyword lists, regex routing, fast paths, silent fallbacks, or post-processing branches. Improve the agent instruction, tool contract, context, or evaluation coverage instead.
