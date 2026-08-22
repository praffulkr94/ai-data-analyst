# No backend: BYOK plus a fixture-replay demo mode

The application is a static deploy with no server. Visitors default to Demo mode — pre-captured
model responses replayed through the real validation, execution and rendering pipeline — and can
switch to their own API key at any time via a header toggle.

**Considered options:** a ~40-line rate-limited proxy holding the author's key was seriously
considered and would also have let visitors use the AI without a key. Fixture replay won because
the same fixture layer is the Playwright mock, so it is dual-use, and because it carries no
infrastructure or cost exposure. The honest framing is that a proxy would be the first addition
if this were a product — for rate limiting and prompt management, not for hiding secrets.
