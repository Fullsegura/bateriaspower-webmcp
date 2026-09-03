# Devpost copy — V1

## Project name

BateríasPower — Search-to-Sale with WebMCP

## Tagline

An AI-guided battery storefront that turns vehicle intent into an interactive catalog and hands complex cases to a live advisor with full context.

## Short description

BateríasPower combines Gemini, Google ADK, native WebMCP tools, and LiveKit to create a seamless search-to-sale experience. A customer describes a vehicle in natural language; the agent updates the live catalog, compares compatible batteries, prepares an informational cart, and can escalate to a human advisor over bidirectional voice and text. The advisor receives the vehicle, conversation, selected product, and product image without making the customer repeat the story.

## Inspiration

Buying the correct automotive battery is harder than it should be. Customers often move between search, product pages, chat, and phone support, repeating vehicle details at every step. We wanted one accessible experience where AI can operate the visible storefront and a human can join with the complete context when needed.

## What it does

- Understands vehicle descriptions written in natural language.
- Uses native WebMCP functions to search, select, compare, and update the visible catalog.
- Keeps the AI chat and storefront synchronized.
- Supports a simple informational quote cart; it does not create orders or charge customers.
- Provides a mobile-first agent bottom sheet.
- Escalates to a live advisor with bidirectional LiveKit voice and text.
- Shares conversation context, vehicle data, selected product, and product image with the advisor.

## How we built it

The storefront and advisor workspace use Next.js. Google ADK orchestrates Gemini-based agents, while native WebMCP functions expose deterministic storefront actions inside the browser. LiveKit powers the standalone human handoff with voice and data messages. The catalog is packaged with the application so the public demo remains self-contained.

## Challenges

The main challenge was keeping three states synchronized: the customer-visible catalog, the AI conversation, and the live advisor session. We also had to preserve a usable mobile layout while the catalog and agent remain available at the same time.

## Accomplishments

- A real browser-native WebMCP flow that visibly changes the storefront.
- A complete search, comparison, selection, and informational-cart journey.
- A standalone human handoff that carries context and the selected product image into a live voice and text session.
- A responsive customer UI and a dedicated advisor workspace.

## What we learned

WebMCP is most valuable when the user stays in the interface and can see every action the agent performs. Structured browser tools make UI updates predictable, while human handoff provides a practical safety net for ambiguity and higher-stakes decisions.

## What's next

- Connect the informational cart to inventory and checkout APIs.
- Add persistent sessions and authenticated customer profiles.
- Expand the compatibility catalog and ERP integration.
- Add production-grade advisor routing, notifications, and analytics.

## Technology

Next.js, React, TypeScript, WebMCP, Gemini, Google ADK, FastAPI, LiveKit, Google Cloud Run, Docker, Vitest, and Pytest.

## Gallery captions

1. **Smart vehicle search** — Describe the vehicle in plain language to begin a guided battery search.
2. **WebMCP updates the storefront** — Gemini invokes native WebMCP tools and the compatible catalog changes in place.
3. **Selection and quote cart** — Choose a compatible battery and add it to a simple informational cart.
4. **Mobile-first AI commerce** — The responsive agent stays within reach while customers browse and compare products.
5. **Human handoff with context** — The customer starts a live voice session without losing the AI conversation or selected product.
6. **Unified advisor workspace** — The advisor receives vehicle context, product image, voice, and live text in one view.
