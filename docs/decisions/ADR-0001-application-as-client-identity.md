# ADR-0001: Application as the Primary Client Identity

## Decision

Use `application` as the primary identity for an approved integration. Keep `user` optional for future multi-user scenarios.

## Rationale

The initial deployment is a controlled runtime operated by one administrator. A full user/subscription/billing system would add complexity without solving the immediate problem.

## Consequences

- Authentication and expiry can be implemented with a small surface.
- Sessions can belong directly to applications.
- Individual users can be added later without redesigning the provider or MCP layers.
- This does not create a public SaaS billing product.
