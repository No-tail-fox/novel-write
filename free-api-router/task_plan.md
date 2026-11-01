# Local Free API Router

## Goal

Provide one stable local OpenAI/Anthropic compatible endpoint that rotates through user-configured upstream accounts while keeping the source directory and availability metadata maintainable.

## Phases

- [x] Inspect the GitHub and BaiPiao sources and separate discovery links from callable endpoints.
- [x] Define a secret-free provider configuration and generated catalog format.
- [x] Implement catalog sync, health checks, routing, and failover.
- [x] Run tests and a local HTTP smoke test.
- [x] Document setup, source limitations, and client examples.
- [x] Create the user's authorized provider token and store it as a user environment variable.
- [x] Obtain a second provider credential (DoCode) and verify authenticated models plus real chat requests.
- [ ] Add more providers when browser authorization and their own registration requirements allow it.
