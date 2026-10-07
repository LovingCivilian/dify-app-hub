# Doc verification of the B1 Dify-layer decisions (2026-10-07)

Read-only check against primary sources. Installed versions seen: Next 16.3.4, React 19.2.6, zod 4.6.5, drizzle-orm 1.0.0-rc.3, Node v24.16.0. Where a quote is from a rendered page, it was taken from a local copy of the page text (React pages via crawl4ai, RFCs via rfc-editor.org .txt, WHATWG specs, MDN, OWASP, Context7). "Empirical" lines are my own throwaway checks (scratchpad, nothing in the repo) and are labelled as such; they are not official sources.

| # | Decision (short) | Verdict |
|---|---|---|
| 1a | setState updater must be pure (Strict Mode calls it twice in development) | SUPPORTED |
| 1b | Documented way to read latest state in a handler without re-subscribing is a `useRef` | PARTLY (refs are documented for it, but for Effects the documented tool is `useEffectEvent`, with restrictions) |
| 1c | No `ref.current` writes during render; update in event handlers or effects | SUPPORTED (rule is "do not write or read during render", one initialisation exception) |
| 2 | Gateway with an invalid upstream response answers 502 (RFC 9110 15.6.3) | SUPPORTED |
| 3 | Decoded gzip body: `Content-Length` still describes the encoded length, do not forward it | SUPPORTED (Fetch Standard says it "makes the Content-Length header unreliable"; Node 24 confirmed empirically) |
| 4 | `public` lets a shared cache store even with a cookie; `private` forbids shared caches | PARTLY (public/private semantics supported; RFC 9111 does not treat `Cookie` requests specially, only `Authorization`) |
| 5 | RFC 3986 unreserved set; WHATWG dot-segment forms removed, `%2F`/`%5C` stay encoded | SUPPORTED (note: a literal `\` IS a separator in http/https URLs) |
| 6 | Serving uploads: nosniff, attachment, `<img>` unaffected by Content-Disposition, SVG script behaviour, CSP sandbox, OWASP | PARTLY (the `<img>` vs Content-Disposition claim has no explicit official statement; OWASP does not mention CSP `sandbox` for uploads) |
| 7 | "Extract a MIME type" splits on commas, last valid MIME type wins | SUPPORTED |
| 8 | `redirect: 'error'` makes a redirect a network error (fetch rejects) | SUPPORTED |
| 9 | Server Component `redirect()` outside try/catch; Route Handler `GET` not cached by default since Next 15 | SUPPORTED |
| 10 | ``sql<boolean>`${col} IS NOT NULL`.mapWith(Boolean)`` is the documented way to compute a boolean column in a select | PARTLY (partial select with `sql<T>` + `.mapWith(<constructor>)` is documented, but with `Number`, not `Boolean`) |
| 11 | zod 4 `z.object` strips unknown keys; `z.url()` accepts any scheme unless `{ protocol }` | SUPPORTED |

---

## 1. React: updater purity, latest state in handlers, writing refs during render

### 1a. Updater functions must be pure; Strict Mode calls them twice

- Source: https://react.dev/reference/react/useState (Caveats and Troubleshooting "My initializer or updater function runs twice"); https://react.dev/reference/rules/components-and-hooks-must-be-pure (side effects must run outside of render).
- Quote: "If you pass a function as `nextState`, it will be treated as an _updater function_. It must be pure, should take the pending state as its only argument, and should return the next state."
- Quote: "In Strict Mode, React will **call your updater function twice** in order to help you find accidental impurities. This is development-only behavior and does not affect production."
- Quote: "**Only component, initializer, and updater functions need to be pure.** Event handlers don't need to be pure, so React will never call your event handlers twice."
- Quote (rules page): "Side effects are typically written inside of event handlers or Effects. But never during render."
- Verdict: SUPPORTED.
- Note: a network request inside an updater is a side effect. react.dev names mutation and "untracked side effects" as the examples; a network call is not named literally, but it falls under the general definition on the rules page ("code that has any observable effect other than its primary result of returning a value to the caller"). In production the updater runs once, so the double request would show up only in development, which is the point of the Strict Mode check.

### 1b. Reading the latest state from a handler without re-subscribing

- Source A: https://react.dev/learn/referencing-values-with-refs, Challenge 4 "Read the latest state".
- Quote A: "State works like a snapshot, so you can't read the latest state from an asynchronous operation like a timeout. However, you can keep the latest input text in a ref. A ref is mutable, so you can read the `current` property at any time. ... You will need to update the current ref value manually." (the solution updates `textRef.current` inside the `onChange` handler, not during render)
- Source B: https://react.dev/reference/react/useEffectEvent (exported by the installed React 19.2.6, `typeof React.useEffectEvent === "function"` checked, and documented on react.dev without a Canary/Experimental notice).
- Quote B: "Effect Events ... always 'see' the latest values from render (like props and state) without re-synchronizing your Effect, so they're excluded from Effect dependencies."
- Quote B (restrictions): "Effect Events can only be called from inside Effects or other Effect Events. Do not call them during rendering or pass them to other components or Hooks." and "Effect Event functions do not have a stable identity."
- Verdict: PARTLY.
- Note: the decision as worded ("the documented way ... is a `useRef`") is too absolute. react.dev documents the ref approach (Challenge 4 above, plus the useRef page: "You can read or write refs from event handlers or effects"), but for the case "an Effect needs the latest props/state without re-running" the documented, preferred tool is `useEffectEvent`. `useEffectEvent` cannot be used where the callback is handed to another component, hook or library (for example a function passed into a client or `fetch` option), because it must be called only from Effects and has no stable identity. For that case the latest-ref pattern (state mirrored into a ref in an event handler or effect) is the standard fallback, but react.dev has no page that names it as "the" pattern beyond Challenge 4. Reword to: "a `useRef` mirror, updated in a handler or effect, is a documented way; `useEffectEvent` is the documented way when the reader is an Effect".

### 1c. Writing `ref.current` during render

- Source: https://react.dev/reference/react/useRef (Caveats and "Best practices for refs"); https://react.dev/learn/referencing-values-with-refs (Recap).
- Quote: "Do not write _or read_ `ref.current` during rendering, except for initialization. This makes your component's behavior unpredictable."
- Quote: "You can read or write refs **from event handlers or effects instead**."
- Quote: "If you _have to_ read or write something during rendering, use state instead."
- Quote (refs page): "Don't read or write `ref.current` during rendering. ... (The only exception to this is code like `if (!ref.current) ref.current = new Thing()` which only sets the ref once during the first render.)"
- Verdict: SUPPORTED. Not allowed during render (lazy initialisation excepted); update it in an event handler, or in an Effect / layout effect.
- Note: `useRef` docs also warn "If it holds an object that is used for rendering ... you shouldn't mutate that object".

---

## 2. Gateway answers 502 for an invalid upstream response

- Source: RFC 9110 section 15.6.3 https://www.rfc-editor.org/rfc/rfc9110#section-15.6.3
- Quote: "The 502 (Bad Gateway) status code indicates that the server, while acting as a gateway or proxy, received an invalid response from an inbound server it accessed while attempting to fulfill the request."
- Verdict: SUPPORTED.
- Note: the RFC says "invalid response"; an unparseable body or a non-conforming response from the upstream fits. A transport failure with no response at all is not literally covered by 15.6.3 (many gateways still use 502 for connection refused). If the upstream does not answer in time, the RFC's code is 504 (15.6.5). Keep 502 for malformed/invalid, 504 for timeout.

---

## 3. Decoded gzip body vs the `Content-Length` header

- Source A: Fetch Standard, HTTP-network fetch, https://fetch.spec.whatwg.org/#http-network-fetch
- Quote A: "Set bytes to the result of handling content codings given codings and bytes. This makes the `Content-Length` header unreliable to the extent that it was reliable to begin with."
- Source B: RFC 9110 section 8.6 https://www.rfc-editor.org/rfc/rfc9110#section-8.6
- Quote B: "When transferring a representation as content, Content-Length refers specifically to the amount of data enclosed so that it can be used to delimit framing."  (that is, the bytes on the wire, which are the encoded bytes)
- Source C: Fetch Standard "handle content codings": "Return the result of decoding bytes with codings as explained in HTTP, if decoding does not result in an error, and failure otherwise." (The spec does not say the headers are rewritten; that the header list is left as received is my reading, and the empirical check below confirms it for Node.)
- Empirical (own check, Node v24.16.0, local http server sending gzip with `content-length: 52`): `fetch()` returned a 2400-byte body, `headers.get('content-length')` = `"52"`, `headers.get('content-encoding')` = `"gzip"`. So Node's fetch decodes the body and keeps both headers untouched.
- Undici docs (Context7 `/nodejs/undici`): nothing found that says what happens to these two headers for `fetch`; only the `decompress` interceptor docs for the dispatcher level. "no official undici source found" for the header behaviour; the Fetch Standard note above is the authority.
- Verdict: SUPPORTED.
- Note: forwarding the upstream `Content-Length` (and `Content-Encoding`) together with the decoded body is therefore wrong; drop both (or recompute and drop `Content-Encoding`) when re-serving a body that `fetch` has decoded.

---

## 4. `Cache-Control: public` / `private` and shared caches

- Source A: RFC 9111 section 5.2.2.9 https://www.rfc-editor.org/rfc/rfc9111#section-5.2.2.9
- Quote A: "The public response directive indicates that a cache MAY store the response even if it would otherwise be prohibited ... In other words, public explicitly marks the response as cacheable. For example, public permits a shared cache to reuse a response to a request containing an Authorization header field (Section 3.5)."
- Source B: RFC 9111 section 5.2.2.7 https://www.rfc-editor.org/rfc/rfc9111#section-5.2.2.7
- Quote B: "The unqualified private response directive indicates that a shared cache MUST NOT store the response (i.e., the response is intended for a single user)."
- Source C: RFC 9111 section 3.5: "A shared cache MUST NOT use a cached response to a request with an Authorization header field ... unless the response contains a Cache-Control field with a response directive ... [that] allows it to be stored by a shared cache"; and section 7.3: "Note that the Set-Cookie response header field [COOKIE] does not inhibit caching; a cacheable response with a Set-Cookie header field can be (and often is) used to satisfy subsequent requests to caches."
- Source D: MDN Cache-Control https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control
- Quote D: "You should add the `private` directive for user-personalized content, especially for responses received after login and for sessions managed via cookies. If you forget to add `private` to a response with personalized content, then that response can be stored in a shared cache and end up being reused for multiple users, which can cause personal information to leak."
- Quote D: "The `public` response directive indicates that the response can be stored in a shared cache. Responses for requests with Authorization header fields must not be stored in a shared cache; however, the public directive will cause such responses to be stored in a shared cache."
- Verdict: PARTLY.
- Note: `private` forbids shared-cache storage and `public` permits storage that would otherwise be prohibited: both SUPPORTED. What the RFC does not say is anything about a request `Cookie` header: only `Authorization` request headers get special treatment (section 3.5). A response to a cookie-bearing request is storable by a shared cache anyway when it is otherwise cacheable, `public` is not what "enables" it, and `public` is documented as "unnecessary" for responses that are already cacheable (5.2.2.9: "it is unnecessary to add the public directive to a response that is already cacheable"). So a safe wording is: "`private` (or `no-store`) is what stops a shared cache from storing a cookie-authenticated response; `public` explicitly allows it and should never be sent on such a response".

---

## 5. RFC 3986 unreserved characters and WHATWG dot-segments

- Source A: RFC 3986 section 2.3 https://www.rfc-editor.org/rfc/rfc3986#section-2.3
- Quote A: "unreserved  = ALPHA / DIGIT / "-" / "." / "_" / "~""
- Source B: URL Standard section 4.1 https://url.spec.whatwg.org/#single-dot-path-segment
- Quote B: "A single-dot URL path segment is a URL path segment that is "." or an ASCII case-insensitive match for "%2e". A double-dot URL path segment is a URL path segment that is ".." or an ASCII case-insensitive match for ".%2e", "%2e.", or "%2e%2e"."
- Source C: URL Standard path state (same page, "path state").
- Quote C: "If buffer is a double-dot URL path segment, then: Shorten url's path." and "Otherwise, if buffer is a single-dot URL path segment and if neither c is U+002F (/), nor url is special and c is U+005C (\), append the empty string to url's path."
- Quote C (what stays encoded): the path state ends with "UTF-8 percent-encode c using the path percent-encode set and append the result to buffer", and U+0025 (%) is only validated ("If c is U+0025 (%) and remaining does not start with two ASCII hex digits, invalid-URL-unit validation error"), never decoded, so `%2F` and `%5C` are appended to the segment as written.
- Empirical (Node 24 `new URL(p, "http://h").pathname`): `/a/../b` -> `/b`; `/a/%2e%2e/b` -> `/b`; `/a/.%2E/b` -> `/b`; `/a/%2E./b` -> `/b`; `/a/%2e/b` -> `/a/b`; `/a/%2F/b` -> `/a/%2F/b`; `/a/%5C/b` -> `/a/%5C/b`; `/a/..%2fb` -> `/a/..%2fb` (not a dot segment); `/a/..\b` -> `/b`.
- Verdict: SUPPORTED.
- Note: two precision points. (1) A literal backslash is a separator for special schemes (http, https): the path state treats "url is special and c is U+005C (\)" like "/". Only the percent-encoded `%5C` stays inside the segment. (2) The decision says `%2e` etc. are "case-insensitive": the standard says "ASCII case-insensitive match", so `%2E` counts. A segment like `..%2f` or `%2e%2e%2f` is a single ordinary segment and is NOT removed; a server that percent-decodes a path segment itself (after the URL parser) can reintroduce traversal, which is why checks must run on the decoded value too.

---

## 6. Serving user-uploaded files

### 6a. `X-Content-Type-Options: nosniff`

- Source: MDN https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options
- Quote: "For example, if a server sends a response with `Content-Type: text/plain` and `X-Content-Type-Options: nosniff`, the browser will not interpret it as HTML, even if the content contains HTML markup. This prevents XSS-attacks where user-uploaded content is executed as an HTML document ..."
- Verdict: SUPPORTED. (Empirical, Chromium via Playwright 1.63: an SVG body served as `text/plain` + nosniff stayed `document.contentType = "text/plain"`, no script ran.)

### 6b. `Content-Disposition: attachment` on a top-level navigation

- Source A: MDN https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Disposition
- Quote A: "`attachment` (indicating it should be downloaded; most browsers presenting a 'Save as' dialog ...)"
- Source B: RFC 6266 section 4.2: "If the disposition type matches "attachment" (case-insensitively), this indicates that the recipient should prompt the user to save the response locally, rather than process it normally (as per its media type)."
- Source C: HTML Standard, "attempt to populate the history entry's document": "Otherwise, if navigationParams's response has a `Content-Disposition` header specifying the attachment disposition type: ... Handle as a download navigationParams's response ..." (subject to sandbox and user-agent permission).
- Verdict: SUPPORTED. (Empirical: Chromium fired a `download` event with filename `a.svg` and did not render the SVG.)

### 6c. Content-Disposition does not affect an `<img>` subresource

- Source: HTML Standard (https://html.spec.whatwg.org/) and Fetch Standard. The only places that read `Content-Disposition` are the navigation steps (6b), the `download` attribute steps, and multipart/form-data parsing (Fetch, "Each part whose `Content-Disposition` header contains a ..."). Image loading is not among them.
- Quote: no sentence says "an image ignores Content-Disposition". MDN's Content-Disposition page only says it indicates "whether content should be displayed inline in the browser as a web page or part of a web page or downloaded as an attachment locally" and has no statement about subresources.
- Empirical (Chromium): `<img src>` of a PNG served with `Content-Disposition: attachment` and of an SVG with `Content-Disposition: attachment` both loaded (`naturalWidth` 1 and 40).
- Verdict: PARTLY. True in behaviour and implied by the spec (the header is consulted only on navigation), but no official source states it explicitly: "no official source found" for the exact claim.

### 6d. SVG top-level can run script on the serving origin; `<img>` SVG cannot

- Source: MDN "SVG as an image" https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image
- Quote: "Browsers support SVG images in: HTML `<img>` or `<svg>` elements ..." ; "JavaScript is disabled." ; "Note that the above restrictions are specific to image contexts; they don't apply when SVG content is viewed directly, or when it's embedded as a document via the `<iframe>`, `<object>`, or `<embed>` elements."
- Empirical (Chromium): the same SVG with `<script>` set `document.title` and fired a `fetch` beacon when opened top-level as `image/svg+xml` (script ran on the serving origin); loaded through `<img>`, no beacon was received.
- Verdict: SUPPORTED. Note that MDN says script is disabled in images ("may apply" wording: "some browsers place restrictions"), so the guarantee is browser behaviour that MDN documents, not a normative statement from the SVG spec.

### 6e. `Content-Security-Policy: sandbox`

- Source A: MDN https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox
- Quote A: "The HTTP Content-Security-Policy (CSP) sandbox directive enables a sandbox for the requested resource similar to the `<iframe>` sandbox attribute. It applies restrictions to a page's actions including preventing popups, preventing the execution of plugins and scripts, and enforcing a same-origin policy."
- Quote A: "A sandboxed resource is otherwise treated as being from an opaque origin ... The Origin of sandboxed resources without the `allow-same-origin` keyword is `null`."
- Source B: CSP Level 3 section 6.3.2 https://www.w3.org/TR/CSP3/#directive-sandbox: "The sandbox directive specifies an HTML sandbox policy which the user agent will apply to a resource, just as though it had been included in an iframe with a sandbox property."
- Verdict: SUPPORTED. (Empirical, Chromium: top-level SVG with `Content-Security-Policy: sandbox` ran no script, title stayed empty, no beacon.)

### 6f. OWASP guidance on serving user content

- Source A: OWASP HTTP Headers Cheat Sheet, "Secure File Download Headers" https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
- Quote A: "When serving user-provided files, proper HTTP headers should be used to prevent unintended execution in the browser. Use Content-Disposition: attachment to force download instead of inline rendering. Use Content-Type: application/octet-stream for unknown or binary files. Ensure X-Content-Type-Options: nosniff is set to prevent MIME type sniffing."
- Source B: OWASP File Upload Cheat Sheet https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- Quote B: "Store the files on a different server. If that's not possible, store them outside of the webroot" ; "In the case of public access to the files, use a handler that gets mapped to filenames inside the application (someid -> file.ext)" ; "Validate the file type, don't trust the Content-Type header as it can be spoofed" ; "Change the filename to something generated by the application".
- Verdict: PARTLY for the CSP part: neither OWASP page recommends `Content-Security-Policy: sandbox` for uploaded content (the CSP cheat sheet only lists `sandbox` as a directive); "no official OWASP source found" for that point. Everything else in the decision (attachment, nosniff, serving through an id-mapped handler, generated names, not trusting the declared type) is covered.
- Note: the OWASP "different host" guidance matters for the SVG case: an inline-served SVG on the app's own origin is same-origin script. `attachment` plus `sandbox` plus nosniff are defence in depth; OWASP's first-choice control is a separate host or origin.

---

## 7. Fetch "extract a MIME type": comma split, last valid type wins

- Source: Fetch Standard section 3.5 https://fetch.spec.whatwg.org/#concept-header-extract-mime-type, with "get, decode, and split" https://fetch.spec.whatwg.org/#concept-header-list-get-decode-split
- Quote (splitting): "Append the result of collecting a sequence of code points that are not U+0022 (") or U+002C (,) from input, given position, to temporaryValue." (values are split at each U+002C outside quoted strings)
- Quote (algorithm): "For each value of values: Let temporaryMimeType be the result of parsing value. If temporaryMimeType is failure or its essence is "*/*", then continue. Set mimeType to temporaryMimeType. ..." and "Return mimeType."
- Quote (worked table in the spec): `Content-Type: text/plain;charset=gbk, text/html` serialises to `text/html`.
- Empirical (Chromium): `Content-Type: image/png;a=b, image/svg+xml` on a script-carrying SVG: `document.contentType` = `image/svg+xml`, script ran when opened top-level, and an `<img>` of the same URL rendered at the SVG's size (40 px, not as a PNG).
- Verdict: SUPPORTED.
- Note: values that fail to parse or are `*/*` are skipped; if none is valid the result is failure. Because the last valid entry wins, a validator that looks only at the first (or at the whole header string) can be fooled into approving `image/png` while the browser uses `image/svg+xml`. Reject any `Content-Type` that contains a comma, or pass the upstream value through the same "last valid wins" parse.

---

## 8. `fetch(..., { redirect: 'error' })`

- Source A: Fetch Standard, request redirect mode https://fetch.spec.whatwg.org/#concept-request-redirect-mode
- Quote A: ""error" - Return a network error when a request is met with a redirect."
- Source B: MDN RequestInit https://developer.mozilla.org/en-US/docs/Web/API/RequestInit
- Quote B: "`error`: Reject the promise with a network error when a redirect status is returned."
- Source C: Fetch Standard HTTP fetch: "Switch on request's redirect mode: "error": Set response to a network error."
- Empirical (Node 24): a 302 response with `redirect: 'error'` rejects with `TypeError: fetch failed`, `cause.message` = `unexpected redirect`; `redirect: 'manual'` resolves with status 302.
- Verdict: SUPPORTED.
- Note: in Node the rejection is a generic `TypeError("fetch failed")`; the redirect reason is only in `error.cause`.

---

## 9. Next.js: `redirect()` and Route Handler caching

- Source A: bundled docs `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md` (Next 16.3.4).
- Quote A: "`redirect` throws an error so it should be called **outside** the `try` block when using `try/catch` statements." and, in the Server Component section, "Invoking the `redirect()` function throws a `NEXT_REDIRECT` error and terminates rendering of the route segment in which it was thrown." ; "`redirect` can be used while rendering in Server and Client Components, Route Handlers, and Server Functions."
- Source B: bundled docs `01-app/02-guides/upgrading/version-15.md`, section "Route Handlers".
- Quote B: "`GET` functions in Route Handlers are no longer cached by default. To opt `GET` methods into caching, you can use a route config option such as `export const dynamic = 'force-static'` in your Route Handler file."
- Source C: `01-app/01-getting-started/15-route-handlers.md`: "Route Handlers are not cached by default. You can, however, opt into caching for `GET` methods."
- Verdict: SUPPORTED.
- Note: the repo's `next.config.ts` has no `cacheComponents`. With Cache Components on, `migrating-to-cache-components.md` says "`GET` handlers follow the same model as pages: they prerender when they don't access uncached or runtime data", which would change the default; not the case here.

---

## 10. Drizzle: computed boolean in a partial select

- Source A: Drizzle docs, MySQL "SQL" page https://orm.drizzle.team/docs/mysql/sql (source `src/content/docs/mysql/sql.mdx`) and PG "Select > Partial select" (via Context7 `/drizzle-team/drizzle-orm-docs`).
- Quote A: "Like in SQL, you can use arbitrary expressions as selection fields, not just table columns" ; "By specifying `sql<string>`, you are telling Drizzle that the **expected** type of the field is `string`. ... Drizzle cannot perform any type casts based on the provided type generic, because that information is not available at runtime. If you need to apply runtime transformations to the returned value, you can use the `.mapWith()` method."
- Quote B (mapWith): "For the cases you need to make a runtime mapping for values passed from database driver to drizzle you can use `.mapWith()`" ... "`sql``.mapWith(Number);`" ; the page's partial-select example is `count: sql<number>`count(*)`.mapWith(Number)`.
- Quote C (Context7 snippet): "Provide a custom runtime mapping by supplying a `DriverValueDecoder` object with `mapFromDriverValue` or passing a constructor function such as `Number` to `.mapWith()`."
- Quote D (MySQL types): "In MySQL, BOOLEAN is a synonym for TINYINT(1), where 0 is false and non-zero values are true." (so `IS NOT NULL` comes back as 0/1 from the driver, which is why a runtime mapping is needed)
- Installed typing (drizzle-orm 1.0.0-rc.3, `sql/sql.d.ts`): `mapWith<TDecoder extends DriverValueDecoder<any, any> | DriverValueDecoder<any, any>['mapFromDriverValue']>(decoder: TDecoder)`, so a plain function such as `Boolean` is accepted.
- Verdict: PARTLY.
- Note: documented: partial select with a raw `sql<T>` expression, `.mapWith(<constructor or DriverValueDecoder>)` for runtime conversion, and the warning that `sql<T>` is a type assertion only. Not documented: a `sql<boolean>` / `IS NOT NULL` / `.mapWith(Boolean)` example, nor `Boolean` by name (the docs only show `Number`). The pattern follows from the documented rules and the installed type allows it; it is not "the documented way to compute a boolean" in those words. In the repo this is `lib/data/apps.ts` `hasIconImage`.

---

## 11. zod 4: unknown keys and `z.url()` schemes

- Source: zod docs, "Api" page for v4.6.5 (https://zod.dev/api, source `packages/docs/content/api.mdx` at tag v4.6.5), via Context7 `/colinhacks/zod`.
- Quote (objects): "By default, unrecognized keys are *stripped* from the parsed result: `Dog.parse({ name: "Yeller", extraKey: true }); // => { name: "Yeller" }`"
- Quote (Context7 snippet, zod source): "object() uses strip (default, unknown keys removed), strictObject() rejects unknown keys, and looseObject() passes unknown keys through."
- Quote (URLs): "To validate any WHATWG-compatible URL: ... `schema.parse("mailto:noreply@zod.dev"); // ✅` As you can see this is quite permissive. Internally this uses the `new URL()` constructor to validate inputs"
- Quote (protocol): "To validate the protocol against a specific regex, use the `protocol` param. `const schema = z.url({ protocol: /^https$/ });` ... `schema.parse("http://example.com"); // ❌`"
- Quote (web URLs): "In many cases, you'll want to validate Web URLs specifically. Use `z.httpUrl()`" (equivalent to `z.url({ protocol: /^https?$/, hostname: z.regexes.domain })`).
- Empirical (zod 4.6.5 installed): `z.url()` accepted `javascript:alert(1)`, `file:///etc/passwd`, `mailto:`, `ftp://`, `data:`; `z.url({ protocol: /^https?$/ })` accepted only the http(s) URL; `z.object({a: z.string()}).parse({a:"1", b:2})` returned `{"a":"1"}`.
- Verdict: SUPPORTED.
- Note: the `protocol` regex is tested against the protocol without the trailing colon (`https`, not `https:`). `z.httpUrl()` is the documented shortcut for web URLs but also requires a domain-style hostname (so it rejects `localhost` and IP literals); use `z.url({ protocol: /^https?$/ })` when those must pass.

---

### Method notes

- Context7 was used for Drizzle (2 commands), zod (1 library + 1 docs) and undici (1 library + 1 docs), React (1 library lookup; the page text itself came from react.dev through crawl4ai), at most three commands per question.
- Empirical checks (own scripts in the session scratchpad, not in the repo): Node `fetch` gzip header behaviour, `redirect: 'error'`, `new URL` dot-segment handling, zod behaviour, and a Chromium (Playwright 1.63) run for the SVG / Content-Disposition / CSP sandbox / comma-MIME cases. They agree with the documents quoted above.
