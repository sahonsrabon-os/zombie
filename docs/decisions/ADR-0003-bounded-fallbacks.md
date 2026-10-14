# ADR-0003: Bounded Fallbacks

## Decision

Provider and tool fallback must be explicitly configured, bounded, observable, and resource-aware.

## Rules

- Maximum attempt count is finite.
- Each attempt has a timeout.
- Retryable and non-retryable errors are distinguished.
- No fallback may silently change a security or data-access boundary.
- Resource pressure stops the loop rather than extending it indefinitely.
