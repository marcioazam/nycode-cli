# Go

Honor the `go` and `toolchain` directives and the CI toolchain; do not impose a global Go version. Keep module boundaries explicit, pass `context.Context` through request-scoped work, wrap errors with useful context, and avoid hidden goroutines or ownership ambiguity.

Prefer small interfaces at the consumer boundary, typed errors or `errors.Is`/`errors.As` where behavior matters, and table-driven tests where they improve coverage. Run the repository's formatter, tests, vet/linter, and race checks when relevant. Add benchmarks for performance-sensitive paths rather than guessing.

Return a literal `nil` for a nil error or interface, never a typed nil pointer. Log an error or return it, not both. Check `Close()` errors on writers and files written to; always `defer resp.Body.Close()` (and drain when reusing the connection).

Bound worker count and queued work separately. Assign ownership for closing channels and waiting for workers; cancellation must unblock producers and consumers as well as the work itself. Give successful completion an explicit path instead of waiting only for errors or a timeout. For changed concurrency behavior, cover normal completion, early consumer exit, and cancellation without leaked workers or blocked sends.

Concurrency guidance adapted 2026-09-20 from Jeffallan's [Go concurrency reference](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/golang-pro/references/concurrency.md), [MIT](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/LICENSE). No example implementation copied.

Current specifics: Go runtime and test rules (Go release notes read 2026-10-24). Apply each item only from the Go version it names, as set by the module's `go` directive and its toolchain:

- Only the two newest majors get fixes, per https://go.dev/doc/devel/release (1.27 and 1.26 on 2026-10-24); report a CI Go version or `toolchain` directive older than both as unsupported. A lower `go` directive alone is a compatibility floor, not a defect: since [1.26](https://go.dev/doc/go1.26), `go mod init` writes one major lower.
- Test timeouts, retries and disconnects in `testing/synctest` bubbles ([1.25+](https://go.dev/doc/go1.25); `synctest.Sleep` and `httptest.NewTestServer` in [1.27](https://go.dev/doc/go1.27)), never with fixed sleeps or longer timeouts. With real I/O (sockets, containers, databases), wait on an observable readiness condition under a bounded deadline. Benchmarks use `for b.Loop()` ([1.24](https://go.dev/doc/go1.24)).
- Back cancel, disconnect and leak claims with the `goroutineleak` profile (1.27); capture latency spikes with `runtime/trace.FlightRecorder` (1.25+).
- On 1.27, `encoding/json` runs on v2, so its error text is no contract; timer channels are always unbuffered (`asynctimerchan` is gone); tracebacks print pprof labels, so keep tenant data out of them.
- GOMAXPROCS follows the container CPU limit since 1.25, so a manual setting is suspect; Green Tea is the default GC since 1.26. Re-baseline performance after a toolchain bump.
- Proxies use `httputil.ReverseProxy.Rewrite`; `Director` is deprecated as unsafe since 1.26.
- Gates never rewrite `go.mod` or `go.sum`: no `go mod tidy` or `go get` unless the dependency change is assigned.
