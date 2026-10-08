# B3 research: the Node LDAP client

Date: 2026-10-09. Scope: which Node LDAP client B3 uses, and how its documented API covers LDAP sign-in (search then bind, JIT accounts linked by `entryUUID` or `objectGUID`) and the periodic directory check, for both Active Directory and OpenLDAP-style servers. Method: npm registry, GitHub at pinned commits, Context7 (`/ldapts/ldapts`), the RFCs from rfc-editor.org, Microsoft Learn and the OpenLDAP 2.6 guide and man pages. Nothing downloaded was run; the only code run was a one-line Node check of the GUID conversion (section 5). Working copies of the sources are under `tmp/b3-research/` (`src/ldapts/`, `rfc*.txt`, `ms/`, `openldap/`, `*.ts.txt`).

---

## 0. Recommendation

**Use `ldapts` 9.2.0 directly. Do not use `ldapjs`, a fork of it, or a wrapper.**

Reasons:

1. `ldapjs` was decommissioned on 2024-05-14, its repository is archived and npm marks it deprecated (section 1). Every `ldapjs` wrapper (`passport-ldapauth` → `ldapauth-fork`, `activedirectory2`) inherits that, and `activedirectory2` is itself deprecated ("Decomissioned.").
2. `ldapts` is the maintained pure-TypeScript client: release 9.2.0 on 2026-09-15, last commit 2026-10-08, 2 open issues (one feature request, one Renovate dashboard), MIT, one runtime dependency that only holds types, `engines.node >=22`, CI on Node 22/24/26, npm provenance attestation, about 621k downloads a week (section 2).
3. Its documented API covers each B3 need: `ldaps://` and StartTLS with a custom CA, `timeout` and `connectTimeout`, simple bind, `unbind`, subtree search with an attribute list, `sizeLimit`, paged search (`paged`, `searchPaginated`), Buffer values for chosen attributes (`explicitBufferAttributes`), RFC 4515 escaping (`escapeFilter`, `Filter.escape`, filter classes), and typed errors per LDAP result code (`InvalidCredentialsError` and the rest) (section 3).
4. Well-known Node projects on the same problem use it: n8n's LDAP login and sync (`packages/cli/package.json:244`, `packages/cli/src/modules/ldap.ee/ldap.service.ee.ts`) and Backstage's LDAP catalog module (`plugins/catalog-backend-module-ldap/package.json:48`).
5. It is pure JavaScript, so the `node:22-alpine` Docker image needs no native build (unlike `ldap-native`, which builds against `libldap`).

Why not the wrapper `ldap-authentication` (it runs on `ldapts`): it adds a second maintainer and a second license (BSD-2-Clause) for about 40 lines of flow that B3 has to own anyway (account key, empty-password refusal, AD disabled filter, error classes). Its source is still worth reading as a reference (section 4).

Five library facts B3 must design around (details in section 3):

- `ldapts` does **not** refuse an empty password: `BindRequest` defaults it to `''` (`src/messages/BindRequest.ts:31`; CHANGELOG 5.0.0, 2023-07-18: "Allow for optional password by setting a default empty string"). The app must refuse it (RFC 4513 §5.1.2 and §6.3.1).
- With `ldap://` plus `startTLS()`, a transparent reconnect (after `unbind()` or a dropped socket) opens a **plain** connection, and a `bind()` sent on it carries the password in clear (`Client.ts:219-221`, `772-780`, `889-935`). Prefer `ldaps://`. If StartTLS is required, do one fresh `Client` per sign-in and never reuse it after `unbind()`.
- `tlsOptions` with any defined value turns on direct TLS **even for `ldap://`** (`Client.ts:219-221`, test "should enable secure mode with tlsOptions containing defined values"). For StartTLS, pass the TLS options to `startTLS()` only, never to the constructor.
- `explicitBufferAttributes` matches attribute names case-sensitively (`SearchEntry.ts:53`). Without it, a binary value comes back as a string whenever its bytes happen to be valid UTF-8 (`Attribute.ts:57-75`). Request `objectGUID` as a Buffer and check it is 16 bytes long.
- Wrong password, disabled, locked and expired accounts all come back as the same `InvalidCredentialsError` (code 49). "Unknown user" is not an error at all: it is a search that returns no entries. Transport failures are plain `Error`s, not `ResultCodeError`s.

---

## 1. ldapjs status, and the next-auth v4 LDAP tutorial

### 1.1 ldapjs is decommissioned

- npm (`npm view ldapjs deprecated`, read 2026-10-09): `"This package has been decomissioned. See https://github.com/ldapjs/node-ldapjs/blob/8ffd0bc9c149088a10ec4c1ec6a18450f76ad05d/README.md"`. Latest version is 3.0.7 (published 2023-12-01). The deprecation was set on 2024-05-14 (`time.modified` 2024-05-14T22:16:44Z).
- GitHub `ldapjs/node-ldapjs`: `archived: true`, last push 2024-05-14, 32 open issues. The last commit is `8ffd0bc9c149088a10ec4c1ec6a18450f76ad05d` (2024-05-14), "Add decommission note".
- README at that commit, https://github.com/ldapjs/node-ldapjs/blob/8ffd0bc9c149088a10ec4c1ec6a18450f76ad05d/README.md : "# Project Decomissioned / This project has been decomissioned. … So, why am I just now deciding to decomission this project? Because today, 2024-05-14, I received the following email … My recommendation to you in regard to LDAP operations: write a gateway in a language that is more suited to these types of operations." It adds: "if I ever do need this project again, I might revive it."
- It still gets about 399,507 downloads a week (npm downloads API, 2026-09-28 to 2026-10-04), mostly through wrappers.

### 1.2 next-auth v4 "LDAP Authentication" tutorial

Source: https://next-auth.js.org/tutorials/ldap-auth-example ("Last updated on Oct 29, 2025"). The page source is `nextauthjs/next-auth@d857eec560fb99c8b18d3b22a2693b849a62d1c3:docs/docs/tutorials/ldap-auth.md`. The site banner reads "NextAuth.js is now part of Better Auth".

What it shows:

- "You will need an additional dependency, `ldapjs`" (`ldap-auth.md:8`).
- The Credentials fields: `username: { label: "DN", type: "text", placeholder: "" }` (`:26`). The user types their **DN**.
- `authorize` does `ldap.createClient({ url: process.env.LDAP_URI })` and then `client.bind(credentials.username, credentials.password, …)`. On success it calls `resolve({ username: credentials.username, password: credentials.password })`. On error it calls `console.error("Failed"); reject()`.
- In the `jwt` callback: `token.username = user.username` and `token.password = user.password` (`:58`). In the `session` callback: `{ ...session, user: { username: token.username } }`.
- The stated intent (`:69`): "The idea is that once one is authenticated with the LDAP server, one can pass through both the username/DN and password to the JWT stored in the browser." API routes read it back with `const { username, password } = token`.

What is unsafe to copy:

1. **The password in the JWT.** next-auth v4's JWT is "an encrypted JWT (JWE) stored in the session cookie" (https://next-auth.js.org/configuration/options, "session" and "jwt"). The directory password then sits in every browser's cookie until the token expires. Anyone holding `NEXTAUTH_SECRET` can read it, and it is replayable against the directory. This conflicts with the project's no-secrets logging and storage rules.
2. **Identity = the typed DN.** The DN changes when an entry is renamed or moved: RFC 4530 §1, "DNs are not stable identifiers"; Microsoft: "An object distinguished name changes if the object is renamed or moved" (Using objectGUID to Bind to an Object). B3's rule is never to use the DN.
3. **A direct bind with user input as the bind name.** On AD, the bind name is tried against 11 name forms: DN, UPN, `DOMAIN\sAMAccountName`, canonical name, `{objectGUID}`, **displayName**, SPN, SID and others (MS-ADTS 5.1.1.1.1). A typed string can therefore authenticate an object the app never looked up.
4. **No empty-password check.** With a non-empty name and an empty password, this is the RFC 4513 §5.1.2 "unauthenticated" bind, and "LDAP server implementations may return a success response to an unauthenticated Bind request" (§6.3.1). The tutorial would then sign anyone in.
5. **No `unbind`, no timeouts, no TLS requirement.** Each attempt leaks a connection, and `LDAP_URI` may be `ldap://`. RFC 4513 §5.1.3: "The name/password authentication mechanism of the simple Bind method is not suitable for authentication in environments without confidentiality protection."
6. **`reject()` without a reason, and console logging.** These cannot be distinguished from a server outage.

---

## 2. Candidates

All figures were read on 2026-10-09: `npm view <pkg> version time license dependencies engines types`, `api.npmjs.org/downloads/point/last-week/<pkg>` (week 2026-09-28 to 2026-10-04) and `gh api repos/<o>/<r>`.

| Package | Latest (date) | Repo activity | Open issues | Types | License | Runtime deps | Node | Downloads/week | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **ldapts** | 9.2.0 (2026-09-15); 9.1.0 (2026-09-15); 9.0.0 (2026-07-11) | `ldapts/ldapts`, not archived; last commit `e670417` on 2026-10-08; 323 stars; main author jgeurts (264 commits; Renovate does most of the rest) | 2 (#454 a feature request, #186 the Renovate dashboard) | bundled (`dist/index.d.mts`, `dist/index.d.cts`) | MIT | `strict-event-emitter-types` 2.0.0 (ISC, no deps, types only) | `engines >=22`; CI matrix `['22','24','26']` (`.github/workflows/ci.yml:23`) | 621,593 | **Use** |
| ldapjs | 3.0.7 (2023-12-01) | archived, decommissioned 2024-05-14 | 32 | none bundled (`@types/ldapjs` 3.0.6) | MIT | 14 (`@ldapjs/*`, `vasync`, `verror`, …) | — | 399,507 | No (section 1) |
| @infisical/ldapjs | 3.0.11 (2026-04-07) | GitHub fork of ldapjs with issues disabled; all commits on 2026-04-07 are packaging changes ("update version to 3.0.11 and re-add @types/ldapjs") | n/a | bundled `types/index.d.ts` | MIT | the same 14 as ldapjs | — | 3,148 | No: a vendor's private republish, not a maintained line |
| ldap-native | 0.1.5 (2026-09-15) | `jinpy666/ldap-native`; 1 star | 8 | bundled | MIT | `node-addon-api` (a native addon on OpenLDAP `libldap`; "falls back to a local native build against the system LDAP client libraries" when there is no prebuild) | `>=20` | 86 | No: new, a single author, native build on Alpine |
| ldap-authentication | 4.4.1 (2026-09-07) | `shaozi/ldap-authentication`, 127 stars | 0 | bundled `index.d.ts` | BSD-2-Clause | `ldapts ^9.0.0` | `>=22.0.0` | 15,331 | Not needed; useful as a reference |
| passport-ldapauth → ldapauth-fork | 3.0.1 (2020-11-16) → 6.1.0 (2024-06-06) | — | — | bundled | MIT | `ldapauth-fork` → `ldapjs ^3.0.7`, `bcryptjs`, `lru-cache` | — | 101,989 / 113,737 | No: built on ldapjs, and a Passport strategy (this app uses next-auth) |
| activedirectory2 | 2.2.0 (2023-06-14) | npm-deprecated: "Decomissioned." | — | — | MIT | `ldapjs ^2.3.3` | — | 24,670 | No |

Reference projects, pinned:

- **ldapts**: n8n `n8n-io/n8n@5b78e8b655452adea7dd0a7199480f2cf773bd35` (`packages/cli/package.json:244` `"ldapts": "catalog:"`, plus `packages/nodes-base/package.json:991`); Backstage `backstage/backstage@75128025b788bb70e46553141a9a66f80777116c` (`plugins/catalog-backend-module-ldap/package.json:48` `"ldapts": "^8.0.6"`).
- **ldapjs line**: Rocket.Chat `RocketChat/Rocket.Chat@a6ae19882c0ff7b644ae80116c14d7ecf2491265` (`apps/meteor/package.json:251` `"ldapjs": "^2.3.3"`); LibreChat `danny-avila/LibreChat@e1dfc10449ff713faffacd60273fddcfe2c0a698` (`passport-ldapauth ^3.0.1`); Infisical `Infisical/infisical@b44114a1d97e361d6ac55bac15e4b352da6b823c` (`backend/package.json:190` `"@infisical/ldapjs": "3.0.11"` and `:278` `passport-ldapauth`).

---

## 3. ldapts 9.2.0: the documented API, mapped to B3

Pin: `ldapts/ldapts` tag `v9.2.0` = commit `b38cfc3ecfa71ebd59ddfcf2f7d49887ae84fad2`. `git diff v9.2.0 main -- README.md src` is empty, so `main@e670417788d7841dafd969d0597421db1950e656` has the same README and sources. Line numbers below refer to v9.2.0. Context7 (`/ldapts/ldapts`, Medium reputation, 457 snippets) returns the same API, but cites generated `_autodocs/` files that are not in the repository, so the README and source are cited instead.

### 3.1 Creating a client: `url`, `timeout`, `connectTimeout`, `tlsOptions`

README "Create a client" (lines 41-73):

```ts
const client = new Client({
	url: 'ldaps://ldap.jumpcloud.com',
	timeout: 0,
	connectTimeout: 0,
	tlsOptions: { minVersion: 'TLSv1.2' },
	strictDN: true,
})
```

- "You can use `ldap://` or `ldaps://`; the latter would connect over SSL (note that this will not use the LDAP TLS extended operation, but literally an SSL connection to port 636…)".
- The options table: `url` "A valid LDAP URL (proto/host/port only)"; `timeout` "Milliseconds client should let operations live for before timing out (Default: Infinity)"; `connectTimeout` "Milliseconds client should wait before timing out on TCP connections (Default: OS default)"; `tlsOptions` "TLS connect() options"; `autoRebind` "(Default: false)"; also `createConnection` and `createSecureConnection`.
- Source: `timeout` and `connectTimeout` default to `0`, meaning off (`Client.ts:200-201`). The URL must be `ldap:` or `ldaps:`, otherwise it throws "`<url>` is an invalid LDAP URL (protocol)" (`:205-217`). The default port is 636 for `ldaps` and 389 otherwise (`:233-239`).
- **A custom CA**, README "Use `Client` Constructor for LDAPS" (lines 727-743): `tlsOptions: { ca: [fs.readFileSync('/path/to/ca-cert.pem')] }`. Node 22 `tls.connect` `ca`: "If specified, the default list would be completely replaced (instead of being concatenated)" (nodejs.org/docs/latest-v22.x/api/tls.md).
- **Gotcha:** `this.secure = isSecureProtocol || hasTlsOptions`, where `hasTlsOptions` is true when any `tlsOptions` value is defined (`Client.ts:219-221`). The tests pin this ("should enable secure mode with tlsOptions containing defined values" on `ldap://`). CHANGELOG 8.0.36 (2025-12-29): "treat empty tlsOptions as no TLS configuration (#304)". So `ldap://host:389` with `tlsOptions: { ca }` attempts a TLS handshake on 389. `ldap-authentication` documents the same rule in a code comment (`index.js:134-142` at `shaozi/ldap-authentication@5fdb864b65222989ea3721817e4359df3a4c410c`).
- Set both timeouts explicitly. When `timeout` fires, it destroys the socket and rejects with `` `${message.constructor.name}: Operation timed out` `` (`Client.ts:1096-1103`). `connectTimeout` rejects with `Error('Connection timeout')` (`:923-928`). The search request also has a server-side `timeLimit`, in seconds, defaulting to 10 (README search table; `src/messages/SearchRequest.ts:45`).

### 3.2 StartTLS

README "startTLS" (lines 230-250): `startTLS(options, [controls])` "Performs a StartTLS extended operation… `options` TLS connect() options", example `await client.startTLS({ ca: [fs.readFileSync('mycacert.pem')] })`. Also README "Use `client.startTLS` for STARTTLS" (lines 745-761): "Connect to the server using `ldap://` and call `client.startTLS()` to upgrade".

Source (`Client.ts:273-315`): the method sends exop `1.3.6.1.4.1.1466.20037`, then `options.socket = originalSocket` (`:285`), then `tls.connect(options)` (or `createSecureConnection`). It sets `startTLSUpgraded = true` (`:314`).

- **Hostname check:** Node's `tls.connect` `socket` option says "If this option is specified, `path`, `host`, and `port` are ignored, **except for certificate validation**". `ldapts` does not add `host` itself, so pass `host` (and `servername`) to `startTLS({ ca, host, servername })`. This makes the RFC 4513 §3.1.3 server identity check ("the client MUST verify the server's identity") explicit. Whether Node falls back to the socket's own host is not documented (see Not confirmed).
- **Reconnect downgrade.** README lines 94-96: "the client transparently reconnects when it is used after being unbound or after the server closes the connection". On reconnect, `_connect()` uses `this.secure`, which is false for `ldap://` without constructor `tlsOptions` (`:889-935`). `_sendBind` reconnects when it is not connected (`:772-780`), and `search` does the same (`_ensureConnected`, `:872-883`). After an `unbind()` or a dropped socket, a StartTLS client's next `bind()` therefore goes out over plain TCP. README line 130 ("Sessions upgraded with `startTLS()` are not automatically rebound") covers the replayed bind, not this case. Rules: prefer `ldaps://`. With StartTLS, create a new `Client` per sign-in, run all steps on one connection, and do not call `bind` after `unbind`. Optionally pass a `createConnection` factory (a documented option, README lines 75-96) that refuses a second connection.

### 3.3 Simple bind: service account and user

README "bind" (lines 199-228): `bind(dnOrSaslMechanism, [password], [controls])`, "The name (DN) of the directory object that the client wishes to bind as", example `await client.bind('cn=root', 'secret')`. It throws a result-code error on failure (`_sendBind`, `Client.ts:772-780`: `if (result?.status !== MessageResponseStatus.Success) throw StatusCodeParser.parse(result)`).

- Both steps use the same call: the service account `client.bind(env.LDAP_BIND_DN, env.LDAP_BIND_PASSWORD)` and the user `client.bind(entry.dn, password)`.
- A re-bind on the same connection is allowed: RFC 4511 §4.2.1, "Clients may send multiple Bind requests to change the authentication and/or security associations… Authentication from earlier binds is subsequently ignored."
- `autoRebind: true` keeps the bind credentials in memory ("The bind credentials are kept in memory for the lifetime of the client. `unbind()` clears them.", README lines 127-132). B3 does not need it for per-request clients. Leave it off for the user bind.
- `PasswordPolicyControl` (9.1.0, README lines 169-197) can read the OpenLDAP ppolicy response (for example `PasswordPolicyError.AccountLocked`). It is optional, and the ppolicy man page warns that sending that code helps attackers (section 6.2).

### 3.4 Unbind and cleanup

README "unbind" (lines 609-619): "Used to indicate that the client wants to close the connection", `await client.unbind()`. README "Authenticate example" (lines 623-645) uses `try { await client.bind(...) } … finally { await client.unbind(); }`.

Source (`Client.ts:750-766`): `unbind()` clears the remembered rebind, returns at once if not connected, sends `UnbindRequest`, and destroys the socket in `finally`. `Symbol.asyncDispose` calls `unbind()` (`:768-770`; README lines 707-719 shows `await using`). Use `try/finally`, which is the documented pattern and does not depend on `using` support in the toolchain.

### 3.5 Search: base DN, `scope: 'sub'`, filter, `attributes`, `sizeLimit`

README "search" (lines 443-486): `search(baseDN, options, [controls])`, returning `{ searchEntries, searchReferences }`. The options table, lines 462-474:

- `[scope=sub]`: "`sub` - Indicates that the entry specified as the search base, and all of its subordinates to any depth".
- `[filter=(objectclass=*)] (string|Filter)`: "It must conform to the LDAP filter syntax specified in RFC4515".
- `[sizeLimit=0]`: "The maximum number of entries that should be returned… A value of zero indicates no limit… the smaller of the client-requested and server-imposed size limits will be enforced."
- `[timeLimit=10]` (seconds); `[paged=false] (boolean|SearchPageOptions)`; `[explicitBufferAttributes=] (string[])` "List of explicit attribute names to return as Buffer objects".
- `[attributes=] (string[])`: "The special value '+' indicates that all operational attributes should be included… If the set of attributes to request is empty, then the server should behave as if the value '\*' was specified".

Details that matter:

- **Operational attributes must be named.** `entryUUID` is `USAGE directoryOperation` (RFC 4530 §2.4). RFC 4512 §3.4: "Operational attributes are not normally visible. They are not returned in search results unless explicitly requested by name." RFC 4511 §4.5.1.8: "servers will not return operational attributes… unless they are listed by name". In ldapts this is just `attributes: ['entryUUID', 'uid', 'mail', 'cn']`, with no special API. AD: `attributes: ['objectGUID', 'sAMAccountName', 'userPrincipalName', 'mail', 'displayName', 'userAccountControl']`.
- **The entry shape** (`src/messages/SearchEntry.ts:14-17`, `44-75`): `Entry = { dn: string; [attr]: Buffer | Buffer[] | string[] | string }`. A single value comes back as a scalar and several values as an array (`:58-62`). A requested attribute that is missing becomes `[]` (`:68-73`). Keys are the attribute type as the server sent it, so look keys up case-insensitively.
- **The ambiguity check:** with `sizeLimit` set, a `sizeLimitExceeded` (4) result is accepted rather than thrown (`Client.ts:795`: `!(result?.status === MessageResponseStatus.SizeLimitExceeded && searchRequest.sizeLimit)`). `sizeLimit: 2` therefore returns at most two entries, and two means "ambiguous, refuse".
- `searchReferences: string[]` holds continuation references. ldapts returns them and does not follow them. Ignore them for login.

### 3.6 Paged results

README `paged` row: "Used to allow paging and specify the page size. Note that even with paged options the result will contain all of the search results. If you need to paginate over results have a look at to searchPaginated". README "searchPaginated" (lines 488-513) shows `client.searchPaginated(base, { filter, paged: { pageSize: 10 } })` iterated with `for await`.

Source: the control is `PagedResultsControl`, type `1.2.840.113556.1.4.319` (RFC 2696), sent non-critical (`src/controls/PagedResultsControl.ts:17`; `Control.ts:20` `critical = options.critical === true`). The default `pageSize` is 100 (`Client.ts:618`). If only `sizeLimit` is set, the page size becomes `sizeLimit - 1` (`:621-626`). Passing your own `PagedResultsControl` throws "Should not specify PagedResultsControl" (`:607-613`).

For the sync, use `paged: { pageSize: 500 }` (at most AD's MaxPageSize of 1000, section 6.1) and no `sizeLimit`. Without paging, AD stops at MaxPageSize and the search fails with `SizeLimitExceededError`. That is "the client MUST specify the paged search control" (MS-ADTS 3.1.1.3.4.6).

### 3.7 Binary attributes (`objectGUID` as a Buffer)

README "Return buffer for specific attribute" (lines 584-607): "Depending on the server software, you may be able to append `;binary`… However, some servers are very strict… In those cases, you can tell ldapts to explicitly return a Buffer: `explicitBufferAttributes: ['jpegPhoto']`."

Source:

- `Attribute.parse` keeps the raw bytes, and decodes values with a fatal UTF-8 decoder unless the type ends in `;binary`. If decoding fails, the value is kept as a Buffer (`src/Attribute.ts:57-75`, `81-83`).
- `SearchEntry.toObject` uses the raw buffers when `explicitBufferAttributes.includes(attribute.type)` or when any value is already a Buffer (`SearchEntry.ts:53`).

Consequences:

- **Always pass `explicitBufferAttributes: ['objectGUID']`.** Without it, a GUID whose 16 bytes happen to be valid UTF-8 comes back as a string.
- The match is case-sensitive, and AD's lDAPDisplayName is `objectGUID`. Still check `Buffer.isBuffer(v) && v.length === 16` before use.
- n8n does the same: `explicitBufferAttributes: BINARY_AD_ATTRIBUTES` with `['objectGUID', 'objectSid']` (`ldap.service.ee.ts:253`, `constants.ts:7`).
- `entryUUID` is a string by syntax (RFC 4530 §2.1, "UUID values are encoded using the [ASCII] character string representation"), so it needs no Buffer.

### 3.8 Building filters safely (RFC 4515)

README "Filter Strings" (lines 515-582): "any search filter syntax characters, such as the wildcard character `*` or parentheses, must be escaped… to prevent such characters in a string from an untrusted source to be misinterpreted as syntax characters (preventing injection attacks). The easiest way to do that is the `escapeFilter` tagged template literal, which escapes every interpolated value while leaving the filter syntax itself alone". It shows:

```ts
import { escapeFilter } from 'ldapts'
const filter = escapeFilter`(email=${value})`
// or
import { Filter } from 'ldapts'
const filter = `(email=${Filter.escape(value)})`
```

It adds: "Interpolated strings and Buffers are escaped; numbers and booleans are stringified."

- Source: `Filter.escape` (`src/filters/Filter.ts:31-67`) turns `*`, `(`, `)`, `\` and NUL into `\2a \28 \29 \5c \00`, and escapes **every byte** of a Buffer as `\xx`. `escapeFilter` (`src/filters/escapeFilter.ts:13`) applies `Filter.escape` to each interpolation.
- RFC 4515 §3: "the octets that represent the ASCII characters "\*" (ASCII 0x2a), "(" (ASCII 0x28), ")" (ASCII 0x29), "\" (ASCII 0x5c), and NUL (ASCII 0x00) are represented as a backslash "\" (ASCII 0x5c) followed by the two hexadecimal digits representing the value of the encoded octet." This is the same set.
- History: `escapeFilter` was added in 8.2.0 (2026-07-11, #436), and `Filter.escape()` was fixed and documented in the same release. 9.0.0 (2026-07-11) removed the deprecated instance `Filter#escape`. B3 needs `ldapts >=9`.
- **Filter objects** avoid string parsing completely: `new EqualityFilter({ attribute, value })` (value `string | Buffer`, written as a raw OCTET STRING, `src/filters/EqualityFilter.ts:8-43`), together with `AndFilter({ filters })`, `OrFilter`, `NotFilter({ filter })` and `ExtensibleFilter`. They are exported from the package root (`src/filters/index.ts`, `src/index.ts`). `search` accepts `filter: Filter | string` (`Client.ts` SearchOptions). `ldap-authentication` uses `new ldapts.EqualityFilter(...)` (`index.js:207`).
- **Matching-rule filters parse:** the ldapts test `tests/FilterParser.test.ts:1300-1301` parses `(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))` into an `ExtensibleFilter` with `rule: '1.2.840.113556.1.4.803'`.
- **Attribute names** in the literal part are not escaped. If the login attribute comes from `lib/env.ts`, validate it with zod against the RFC 4512 `keystring` form (`ALPHA *(ALPHA / DIGIT / "-")`) or an OID.
- **DN values inside filters** (for example the `1.2.840.113556.1.4.1941` group checks) are filter values too. DNs often contain `\` (RFC 4514 escapes), so pass them through `escapeFilter`.
- OWASP LDAP Injection Prevention Cheat Sheet (`OWASP/CheatSheetSeries@29994dd8a2e6f50fa3d5607b046b54d7c6945afd`, `cheatsheets/LDAP_Injection_Prevention_Cheat_Sheet.md:20,55-78`): "Escape all variables using the right LDAP encoding function", with a pointer to RFC 4515 §3.

### 3.9 Errors: telling a wrong password from an unknown user from a server outage

Source: `StatusCodeParser.parse` maps each LDAP result code to a class (`src/StatusCodeParser.ts:52-120`): 49 → `InvalidCredentialsError` (`:99`), 51 → `BusyError` (`:103`), 52 → `UnavailableError` (`:105`), 8 → `StrongAuthRequiredError`, 13 → `ConfidentialityRequiredError`, 4 → `SizeLimitExceededError`, 32 → `NoSuchObjectError`, and so on. All extend `ResultCodeError`, which has `code: number` and the message `` `${serverMessage} Code: 0x${code}` `` (`src/errors/resultCodeErrors/ResultCodeError.ts:1-12`). All are exported from `ldapts` (`src/errors/resultCodeErrors/index.ts`). README (lines 697-699) shows `if (ex instanceof InvalidCredentialsError) { // Handle authentication specifically }`, and the tests show `rejects.toBeInstanceOf(InvalidCredentialsError)` (`tests/Client.test.ts:364`).

| Situation | What ldapts gives | Source |
| --- | --- | --- |
| Unknown user (search-then-bind) | `search` resolves with `searchEntries.length === 0` (no error) | `_sendSearch` success path, `Client.ts:793-800` |
| Ambiguous login | `searchEntries.length >= 2` (use `sizeLimit: 2`) | `Client.ts:795` |
| Wrong password, or AD disabled, locked or expired, or ppolicy-locked | user `bind` rejects with `InvalidCredentialsError` (code 49) | RFC 4513 §5.1.3: "invalidCredentials indicates that the DN is syntactically correct but not valid for purposes of authentication, that the password is not valid for the DN, or that the server otherwise considers the credentials invalid"; MS-ADTS 5.1.1.1.1; slapo-ppolicy(5) `ppolicy_use_lockout`: "A client will always receive an LDAP InvalidCredentials response when Binding to a locked account" |
| Service account misconfigured | the **first** bind rejects with `InvalidCredentialsError`: a configuration fault, not a user fault (tell it apart by which step failed) | same |
| Server needs TLS for simple bind | `StrongAuthRequiredError` (8) or `ConfidentialityRequiredError` (13), depending on the server | `StatusCodeParser.ts`; which code AD sends is not confirmed |
| Server busy or unavailable | `BusyError` (51), `UnavailableError` (52) | `StatusCodeParser.ts:103,105` |
| Host down, refused, DNS, TLS certificate rejected | a **plain `Error`** from the socket, with Node's `code` (`ECONNREFUSED`, `ENOTFOUND`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `DEPTH_ZERO_SELF_SIGNED_CERT`, …) | `_connect` `socket.once('error', … reject(err))` `Client.ts:911-914`; README "Common Errors" lines 763-877; Node `rejectUnauthorized`: "`err.code` contains the OpenSSL error code" |
| Connect timeout or operation timeout | `Error('Connection timeout')`, `Error('<Request>: Operation timed out')` | `Client.ts:923-928`, `1096-1103` |
| Socket dropped mid-operation | `Error('Socket error. Message type: …')` or `Error('Connection closed before message response was received…')` | `Client.ts:958`, `1024` |

Rule: `err instanceof ResultCodeError` means the directory answered. Anything else is a transport failure. Toward the user, OWASP's Authentication Cheat Sheet (same pin, `Authentication_Cheat_Sheet.md:150-154`) says "an application must respond with a generic error message regardless of whether: The user ID or password was incorrect. The account does not exist. The account is locked or disabled." So "not found", "ambiguous" and `InvalidCredentialsError` collapse into one message. Whether "directory unreachable" gets its own message is a design choice.

Logging: `ldapts` writes debug output only through `util.debuglog('ldapts')`, that is under `NODE_DEBUG=ldapts`. Bind passwords are replaced with `'__redacted__'` (`Client.ts:1124-1131`), but search requests, including the filter with the login name, are logged in full. Keep `NODE_DEBUG` off in production. `ResultCodeError.message` carries the server's diagnostic text (AD's text has sub-codes); log the `code` and class name, and do not log the DN or the login name, in line with `lib/error-log.ts`.

### 3.10 An empty password

RFC 4513 §5.1.2: "users intending to perform Name/Password Authentication may inadvertently provide an empty password and thus cause poorly implemented clients to request Unauthenticated access. Clients SHOULD be implemented to require user selection of the Unauthenticated Authentication Mechanism by means other than user input of an empty password. Clients SHOULD disallow an empty password input to a Name/Password Authentication user interface." §6.3.1: "LDAP server implementations may return a success response to an unauthenticated Bind request. This may erroneously leave the client with the impression that the server has successfully authenticated the identity… Clients that use the results from a simple Bind operation to make authorization decisions should actively detect unauthenticated Bind requests (by verifying that the supplied password is not empty) and react appropriately." §5.1.1: a zero-length name with a zero-length password is the anonymous bind.

**ldapts does not refuse it.** `this.password = options.password ?? ''` (`src/messages/BindRequest.ts:31`). CHANGELOG 5.0.0 (2023-07-18): "Allow for optional password by setting a default empty string. Fix #134". The bind sends whatever it gets.

So the zod schema for the sign-in input must require `password.length > 0`, and must not trim it, since spaces can be part of a password. It must also require a non-empty login. Check `entry.dn` is non-empty before the user bind, and validate at start-up that the service-account DN and password in `lib/env.ts` are non-empty. OWASP LDAP cheat sheet, same pin, line 157: "When using name/password authentication, reject empty passwords before binding. A nonempty name with an empty password can perform an unauthenticated bind that establishes anonymous authorization; a successful result in that case does not prove the user's identity."

### 3.11 Next.js and runtime notes

- `ldapts` imports `node:net` and `node:tls`, so it is server-only, inside next-auth's `authorize` (a Route Handler) and the sync job. Next's bundled guide (`node_modules/next/dist/docs/01-app/02-guides/package-bundling.md:252-254`, Next 16.3.4): "Packages imported inside Server Components and Route Handlers are automatically bundled by Next.js. You can opt specific packages out of bundling using the `serverExternalPackages` option". That is the documented fallback if bundling misbehaves (not tested).
- Docker: `node:22.21.1-alpine` (repo `Dockerfile:1,14`). `ldapts` has `engines.node >=22` and no install scripts (`npm view ldapts@9.2.0 scripts.*` is empty). Its npm tarball has an SLSA provenance attestation (`dist.attestations.provenance.predicateType = https://slsa.dev/provenance/v1`).
- Connections: AD closes idle connections after MaxConnIdleTime, 900 s (MS-ADTS 3.1.1.3.4.6). Use one client per sign-in, and one client for a whole sync run. Do not pool.

---

## 4. The "search then bind" flow

Authoritative descriptions:

- **Apache httpd `mod_authnz_ldap`**, "The Authentication Phase" (https://httpd.apache.org/docs/2.4/mod/mod_authnz_ldap.html#authenphase): "During the authentication phase, mod_authnz_ldap searches for an entry in the directory that matches the username that the HTTP client passes. If a single unique match is found, then mod_authnz_ldap attempts to bind to the directory server using the DN of the entry plus the password provided by the HTTP client. Because it does a search, then a bind, it is often referred to as the search/bind phase." The steps: "1. Generate a search filter by combining the attribute and filter… with the username… 2. Search the directory using the generated filter. If the search does not return exactly one entry, deny or decline access. 3. Fetch the distinguished name of the entry retrieved from the search and attempt to bind to the LDAP server using that DN and the password passed by the HTTP client. If the bind is unsuccessful, deny or decline access." `AuthLDAPBindDN` is "An optional DN to bind with during the search phase".
- **Grafana LDAP** (https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/ldap/#bind-and-bind-password): "By default the configuration expects you to specify a bind DN and bind password. This should be a read only user that can perform LDAP searches. When the user DN is found a second bind is performed with the user provided username and password (in the normal Grafana login form)."
- **RFC 4513** gives the reason a search is needed. The name/password mechanism takes "a name (in the form of an LDAP distinguished name [RFC4514]) and a password" (§5.1, §5.1.3), and users do not know their DN. RFC 4511 §4.2.1 allows the second bind on the same connection ("Authentication from earlier binds is subsequently ignored").
- **AD-specific reason to bind with the found DN:** AD tries the bind name against 11 name forms in turn, and "If the name field of the BindRequest maps to more than one object, the BindRequest fails with the error invalidCredentials" (MS-ADTS 5.1.1.1.1). Binding with the DN from the search pins the bind to the entry whose `objectGUID` B3 records.
- **The node reference implementations** both do service bind → `search` with an escaped filter → bind as `entry.dn`:
  - n8n `findAndAuthenticateLdapUser` (`ldap.service.ee.ts:307-350`).
  - `ldap-authentication`: `_searchUser` refuses `searchEntries.length > 1` with `AUTH_RESULT_FAILURE_IDENTITY_AMBIGUOUS` (`index.js:228-240`).
  - n8n instead takes the last of several matches (`searchResult.pop()`, `:333-338`), which contradicts Apache's "exactly one". Do not copy that, and do not copy n8n's linking of an existing email account to the LDAP identity (`handleLogin`, `:574-620`). B3 links by the directory key only.

The flow for B3, expressed only in the documented calls above (a sketch, not code to paste):

```ts
// input already parsed by zod: login.length > 0, password.length > 0 (RFC 4513 §5.1.2)
const client = new Client({
  url: env.LDAP_URL,                       // prefer ldaps://
  connectTimeout: 5_000, timeout: 10_000,  // both off by default
  tlsOptions: isLdaps ? { ca, minVersion: 'TLSv1.2' } : undefined, // never with ldap:// (3.1)
});
try {
  if (useStartTls) await client.startTLS({ ca, host, servername: host, minVersion: 'TLSv1.2' });
  await client.bind(env.LDAP_BIND_DN, env.LDAP_BIND_PASSWORD);          // service account
  const { searchEntries } = await client.search(env.LDAP_USER_BASE_DN, {
    scope: 'sub',
    filter: isAd
      ? escapeFilter`(&(objectCategory=person)(objectClass=user)(sAMAccountName=${login})(!(userAccountControl:1.2.840.113556.1.4.803:=2)))`
      : escapeFilter`(&(objectClass=inetOrgPerson)(uid=${login}))`,
    attributes: isAd ? ['objectGUID', 'mail', 'displayName', 'userAccountControl'] : ['entryUUID', 'mail', 'cn'],
    explicitBufferAttributes: isAd ? ['objectGUID'] : [],
    sizeLimit: 2,                                                      // 2 results = ambiguous
  });
  if (searchEntries.length !== 1) return null;                         // Apache: "exactly one"
  const entry = searchEntries[0];
  const key = isAd ? objectGuidToString(entry.objectGUID) : normaliseUuid(entry.entryUUID); // section 5
  await client.bind(entry.dn, password);                               // InvalidCredentialsError → null
  return { key, mail: …, name: … };                                    // JIT create / update by key
} catch (e) {
  if (e instanceof InvalidCredentialsError) return null;              // generic message (OWASP)
  throw e;                                                             // transport / config → "directory unavailable"
} finally {
  await client.unbind();
}
```

(The filter text is in the template's literal parts; only `${login}` is escaped. The `(…)` user-class part comes from configuration and must be validated, not interpolated raw from user input.)

---

## 5. Key string forms: `objectGUID` and `entryUUID`

### 5.1 objectGUID (Active Directory)

- The attribute: "The unique identifier for an object." Size "16 bytes", Update Frequency "This value is set when the object is created and cannot be changed." (https://learn.microsoft.com/en-us/windows/win32/adschema/a-objectguid). "an object's objectGUID property never changes, even if the object is renamed or moved" (https://learn.microsoft.com/en-us/windows/win32/ad/using-objectguid-to-bind-to-an-object, updated 2020-08-17). MS-ADTS 3.1.1.1.3: "The identifying attribute is objectGUID".
- **Byte order**, MS-DTYP 2.3.4.2 "GUID--Packet Representation" (https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-dtyp/001eec5a-7f8b-4293-9e21-ca349392db40): "**Data1 (4 bytes):** The value of the Data1 member…, in little-endian byte order. **Data2 (2 bytes):** … in little-endian byte order. **Data3 (2 bytes):** … in little-endian byte order. **Data4 (8 bytes):** … in little-endian byte order." Data4 is a byte array, so its order is unchanged. MS-DTYP 2.3.4.1: Data1/2/3 are `time_low`, `time_mid` and `time_hi_and_version`. MS-DTYP 2.3.4.3: the string form is "{" UUID "}" with "UUID represents the string form of a UUID, as specified in [RFC4122] section 3", for example `{f81d4fae-7dec-11d0-a765-00a0c91e6bf6}`.
- **.NET states the same mapping** (https://learn.microsoft.com/en-us/dotnet/api/system.guid.tobytearray): "the order of bytes in the returned byte array is different from the string representation of a Guid value. The order of the beginning four-byte group and the next two two-byte groups is reversed, whereas the order of the last two-byte group and the closing six-byte group is the same."
- **A worked example from Microsoft** (the archived TechNet wiki on Learn, "Active Directory: LDAP Syntax Filters", note 8; https://learn.microsoft.com/en-us/archive/technet-wiki/5392.active-directory-ldap-syntax-filters; the page says "This archived content is no longer being maintained"): "The GUID {b95f3990-b59a-4a1b-9e96-86c66cb18d99} is equivalent to the hex representation "90395fb99ab51b4a9e9686c66cb18d99". Notice how the order of the first 8 bytes is reversed in groups. You specify the escaped hex bytes. You cannot specify the form in curly braces in a filter."
- AD also accepts this string form in a bind name: name form 5, "The value of the objectGUID attribute of the object, expressed in dashed-string form ([RFC4122] section 3) and surrounded by curly braces" (MS-ADTS 5.1.1.1.1).

Mapping (bytes `b[0..15]` as returned by `explicitBufferAttributes`): `b3 b2 b1 b0 - b5 b4 - b7 b6 - b8 b9 - b10 b11 b12 b13 b14 b15`, written as lowercase hex.

```ts
function objectGuidToString(v: unknown): string {
	if (!Buffer.isBuffer(v) || v.length !== 16) throw new Error('objectGUID must be a 16-byte Buffer')
	const h = v.toString('hex')
	return (
		`${h.slice(6, 8)}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}-${h.slice(10, 12)}${h.slice(8, 10)}-` +
		`${h.slice(14, 16)}${h.slice(12, 14)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
	)
}
```

This was checked locally with Node against the Microsoft example: `90395fb99ab51b4a9e9686c66cb18d99` → `b95f3990-b59a-4a1b-9e96-86c66cb18d99` (true). Backstage uses the same template, `'{3}{2}{1}{0}-{5}{4}-{7}{6}-{8}{9}-{10}{11}{12}{13}{14}{15}'` (`plugins/catalog-backend-module-ldap/src/ldap/vendors.ts:126-145` at the Backstage pin). n8n stores the raw `buffer.toString('hex')` instead (`helpers.ee.ts:35-37`). Either is stable, but only the dashed form matches what Microsoft documents as the GUID's string.

To **look a user up by GUID** in the sync or a re-check, keep or rebuild the 16 raw bytes. Then use `escapeFilter\`(objectGUID=${buf})\``(every byte becomes`\xx`, `Filter.ts:33-40`) or `new EqualityFilter({ attribute: 'objectGUID', value: buf })`. ADSI "Search Filter Syntax": "arbitrary binary data may be represented by using the escape sequence syntax by encoding each byte of binary data with the backslash (\\) followed by two hexadecimal digits" (https://learn.microsoft.com/en-us/windows/win32/adsi/search-filter-syntax).

### 5.2 entryUUID (RFC 4530; OpenLDAP and others)

- RFC 4530 §2.1: "A Universally Unique Identifier (UUID) [RFC4122] is a 16-octet (128-bit) value… In LDAP, UUID values are encoded using the [ASCII] character string representation described in [RFC4122]. For example, "597ae2f6-16a6-1027-98f4-d28b5365dc14"."
- §2.4: `( 1.3.6.1.1.16.4 NAME 'entryUUID' … EQUALITY uuidMatch … SINGLE-VALUE NO-USER-MODIFICATION USAGE directoryOperation )`, and "Servers SHALL generate and assign a new UUID to each entry upon its addition to the directory… An entry's UUID is immutable."
- §1: "Clients may use this attribute to distinguish objects identified by a particular distinguished name or to locate a particular object after renaming."
- RFC 4122 §3: "Each field is treated as an integer and has its value printed as a zero-filled hexadecimal digit string with the most significant digit first. The hexadecimal values "a" through "f" are output as lower case characters and are case insensitive on input." It gives the ABNF `UUID = time-low "-" time-mid "-" time-high-and-version "-" clock-seq-and-reserved clock-seq-low "-" node`. RFC 4122 is obsoleted by RFC 9562 (May 2024; "Obsoletes: 4122"), which keeps the format and allows "all uppercase, all lowercase, or mixed case" (§4).
- So: validate against `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$` and store it lowercased. A lookup is `escapeFilter\`(entryUUID=${uuid})\``, which uses `uuidMatch`; RFC 4530 §2.2: "the assertion value is encoded using the UUID string representation".
- Both keys come out as UUID-shaped strings. Store which attribute produced the key (or the directory type) beside it, so that a change of directory type cannot cross-match.

---

## 6. Directory specifics a login and a sync must honour

### 6.1 Active Directory (Microsoft Learn)

- **Disabled accounts.** `userAccountControl` flag "ACCOUNTDISABLE | 0x0002 | 2", "ACCOUNTDISABLE - The user account is disabled." (https://learn.microsoft.com/en-us/troubleshoot/windows-server/active-directory/useraccountcontrol-manipulate-account-properties, updated 2026-02-12). MS-ADTS 2.2.16 (https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-adts/dd302fd1-0aa7-406b-ad91-2a6b35738557): "**D (ADS_UF_ACCOUNT_DISABLE, 0x00000002):** Specifies that the account is not enabled for authentication."
- **The bitwise filter.** "1.2.840.113556.1.4.803 | LDAP_MATCHING_RULE_BIT_AND | A match is found only if all bits from the attribute match the value", and "<value> must be a decimal number" (ADSI Search Filter Syntax). MS-ADTS 3.1.1.3.4.4.1 says the same. The filter `(!(userAccountControl:1.2.840.113556.1.4.803:=2))` is listed as "All enabled user objects": `(&(objectCategory=person) (objectClass=user) (!(userAccountControl:1.2.840.113556.1.4.803:=2)))` (archived TechNet wiki on Learn, above). ldapts parses exactly this filter (`tests/FilterParser.test.ts:1300`). Use it in the login search, and read `userAccountControl` in the sync to deactivate disabled accounts. The bind fails for them anyway (invalidCredentials).
- **Nested groups.** "1.2.840.113556.1.4.1941 | LDAP_MATCHING_RULE_IN_CHAIN | This rule is limited to filters that apply to the DN. This is a special "extended" match operator that walks the chain of ancestry in objects all the way to the root until it finds a match." Examples: base = the user DN, scope base, `(memberof:1.2.840.113556.1.4.1941:=cn=Group1,OU=groupsOU,DC=x)` to test membership; base = the groups container, subtree, `(member:1.2.840.113556.1.4.1941:=cn=user1,cn=users,DC=x)` to list all of a user's groups. "Some such queries on subtrees may be more processor intensive" (ADSI Search Filter Syntax). Normative: MS-ADTS 3.1.1.3.4.4.3 LDAP_MATCHING_RULE_TRANSITIVE_EVAL. Escape the DN value with `escapeFilter`.
- **memberOf.** "The distinguished name of the groups to which this object belongs." Ldap-Display-Name `memberOf`, Syntax Object(DS-DN), System-Only True (https://learn.microsoft.com/en-us/windows/win32/adschema/a-memberof). `primaryGroupID`: "Contains the relative identifier (RID) for the primary group of the user. By default, this is the RID for the Domain Users group." (a-primarygroupid). That `memberOf` omits the primary group and nested groups is inferred, not quoted (see Not confirmed).
- **Paging.** "MaxPageSize - This value controls the maximum number of objects that are returned in a single search result… To perform a search where the result might exceed this number of objects, the client must specify the paged search control… Default value: 1,000" (https://learn.microsoft.com/en-us/troubleshoot/windows-server/active-directory/view-set-ldap-policy-using-ntdsutil, updated 2026-02-12). MS-ADTS 3.1.1.3.4.6 "LDAP Policies": "MaxPageSize | 1000 | … the client MUST specify the paged search control" and "MaxConnIdleTime | 900 | The maximum time, in seconds, that the client can be idle before the DC closes the connection."
- **Deleted objects are invisible to normal searches, so absence is the signal.**
  - MS-ADTS 3.1.1.3.4.1.14 (https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-adts/4b8f2a0e-9ea6-4be3-b639-4b019948c568): "The LDAP_SERVER_SHOW_DELETED_OID control is used with an LDAP operation to specify that tombstones and deleted-objects MUST be visible to the operation. For example, when the control is used with an LDAP search operation, the search results include any tombstones or deleted-objects that match the search filter."
  - "Retrieving Deleted Objects": "The Deleted Objects container is not normally visible, but the Deleted Objects container can be bound to by a member of the administrators group."
  - "Polling for Changes Using uSNChanged" (https://learn.microsoft.com/en-us/windows/win32/ad/polling-for-changes-using-usnchanged): "To handle moved or deleted objects, store the objectGUID attribute of each tracked object. An object's objectGUID attribute remains unchanged regardless of where it is moved throughout the forest." And: "To handle deleted objects, either perform periodic full synchronizations or perform a separate search for deleted objects when you perform an incremental synchronization."
  - So B3's periodic check is the documented "periodic full synchronization": a paged search with the service account. A key that is absent from a **complete, error-free** result is no longer eligible: deleted, moved out of the base DN, or filtered out (for example disabled). Never deactivate on a partial result (any thrown error, a size-limit error, or a sudden empty result after a permission change).
- **TLS.** "Active Directory does not require, but supports, the use of an SSL/TLS-encrypted or otherwise protected connection when performing a simple bind" (MS-ADTS 5.1.1.1.1). Domain controllers can be configured "to reject LDAP simple binds that are performed on a clear text (non-SSL/TLS-encrypted) connection" (https://learn.microsoft.com/en-us/troubleshoot/windows-server/active-directory/enable-ldap-signing-in-windows-server). The app must enforce TLS itself.
- **Bind name forms** (MS-ADTS 5.1.1.1.1, https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-adts/6a5891b8-928e-4b75-a4a5-0e3b77eaca52): the forms are tried in turn (DN, UPN, `NetBIOS\sAMAccountName`, canonical name, `{objectGUID}`, displayName, SPN, …). "If the name field of the BindRequest maps to more than one object, the BindRequest fails with the error invalidCredentials / ERROR_INVALID_PARAMETER." The login attribute (`sAMAccountName` or `userPrincipalName`) is for the search only. The bind uses the DN, and the account link uses `objectGUID`.

### 6.2 OpenLDAP

- **entryUUID is present and is the identity.** OpenLDAP 2.6 Administrator's Guide, LDAP Sync replication (https://www.openldap.org/doc/admin26/guide.html): "In the LDAP Sync protocol, entries are uniquely identified by the entryUUID attribute value. It can function as a reliable identifier of the entry. The DN of the entry, on the other hand, can be changed over time and hence cannot be considered as the reliable identifier." Its slapcat example shows `entryUUID: 2134b714-e3a1-102c-9a15-f96ee263886d` on an ordinary entry. On requesting it, the guide's monitor chapter says: "LDAP only returns operational attributes that are explicitly requested. Requesting attribute "+" is an extension which requests all operational attributes." Ask for `entryUUID` by name.
- **memberOf is an overlay, not a default.** Guide §12.8 "Reverse Group Membership Maintenance": "The memberof overlay updates an attribute (by default memberOf) whenever changes occur to the membership attribute (by default member) of entries of the objectclass (by default groupOfNames) configured to trigger updates." And: "Note that the memberOf attribute is an operational attribute, so it must be requested explicitly." slapo-memberof(5) for 2.6: "Note that the dynlist overlay can also provide this functionality". slapo-dynlist(5) for 2.6: "If the optional \* character is also specified, then the member and memberOf values will be populated recursively, for nested groups." Without either overlay, group membership needs a search on the groups (for example `(&(objectClass=groupOfNames)(member=<escaped user DN>))`).
- **Disabled or locked markers.** There is no standard "disabled" attribute. With the ppolicy overlay, slapo-ppolicy(5) for 2.6 says: "pwdAccountLockedTime — This attribute contains the time that the user's account was locked. If the account has been locked, the password may no longer be used to authenticate the user to the directory. If pwdAccountLockedTime is set to 000001010000Z, the user's account has been permanently locked and may only be unlocked by an administrator. Note that account locking only takes effect when the pwdLockout password policy attribute is set to "TRUE"." It is `USAGE directoryOperation`, so request it by name. A bind to a locked account returns InvalidCredentials (`ppolicy_use_lockout` text, section 3.9). For OpenLDAP, a sign-in therefore relies on the bind result. A sync relies on absence, plus `pwdAccountLockedTime` where ppolicy is deployed.
- **Paging.** ldapts' own CI runs against OpenLDAP (`docker-compose.yml`: `osixia/openldap:1.5.0`) with paged searches (`tests/Client.test.ts:1167-1271`).

---

## 7. Risks and decisions for the B3 design

1. **Empty password**: refuse it in zod before any LDAP call. The library sends it.
2. **StartTLS reconnect downgrade**: prefer `ldaps://`. With StartTLS, use one connection per sign-in, never `bind` after `unbind`, and optionally a refusing `createConnection`.
3. **`tlsOptions` + `ldap://`** means direct TLS. Give TLS options to `startTLS()` only.
4. **`objectGUID`**: request it with `explicitBufferAttributes: ['objectGUID']` and check for 16 bytes. The name match is case-sensitive.
5. **Ambiguity**: use `sizeLimit: 2` and accept exactly one entry.
6. **Error classes**: `ResultCodeError` means the directory answered. A plain `Error` means transport. Show one generic message for every credential failure.
7. **Sync**: paged at 500 or less, one client per run, finish within AD's 900 s idle limit, and treat any error as "do not deactivate".
8. **Bus factor**: ldapts is mostly one maintainer (jgeurts, 264 commits) plus Renovate. CI covers OpenLDAP only, with no AD, so AD behaviour (GUID buffers, referrals, paging at 1000) needs a live check against the owner's directory.
9. Do not adopt the next-auth tutorial or n8n patterns that link by email, take the last of several matches, or put the password in the JWT.

---

## Not confirmed

- Whether Node's `tls.connect({ socket })` checks the certificate against the original socket's host when neither `host` nor `servername` is given. The Node docs say only that `host` is used "for certificate validation" when `socket` is set. Pass `host`/`servername` explicitly.
- By reading `n8n@5b78e8b6…:packages/cli/src/modules/ldap.ee/ldap.service.ee.ts:209-300`, n8n's StartTLS mode reuses one `Client` across `unbind()` (`searchWithAdminBinding` unbinds, then `validUser` binds on the same object). Under ldapts' reconnect logic that second connection would be plain TCP. Not tested; it is an inference from the code. Do not copy the pattern either way.
- Backstage's `formatGUID` re-encodes a string value with `Buffer.from(s, 'binary')` (`vendors.ts:126-131`). If ldapts had decoded the GUID as multibyte UTF-8, that would give wrong bytes. This is inferred from `Attribute.ts`, not tested. `explicitBufferAttributes` avoids the question.
- The case of attribute names in results (`entryUUID` as requested, or in schema case). This is server behaviour and not documented by ldapts, so look keys up case-insensitively.
- That AD's `memberOf` excludes the primary group (Domain Users) and nested memberships. The quoted Microsoft pages give `primaryGroupID` and the need for `1.2.840.113556.1.4.1941` but do not say so in one sentence.
- AD's sub-codes in the diagnostic message of result 49 (`data 52e`, `525`, `530`, `532`, `533`, `701`, `773`, `775`) were not found on Microsoft Learn in this session. Do not branch on them.
- Whether AD answers a non-TLS simple bind, when signing is required, with `strongerAuthRequired` (8) or `confidentialityRequired` (13).
- AD's handling of an unauthenticated simple bind (empty password) by default, and any dSHeuristics switch that denies it. The fetched dSHeuristics page did not mention one. Irrelevant if the app refuses empty passwords.
- Whether AD subtree searches from the domain root return continuation references (DomainDnsZones and the like) in `searchReferences`. ldapts returns references without following them, which is harmless for B3.
- Whether AD's LDAP channel binding (EPA) requirements affect simple binds over LDAPS from Node. Not researched; needs a live check if the domain enforces channel binding.
- Other directories' keys: 389 Directory Server / FreeIPA (`nsUniqueId`, `ipaUniqueID`, Backstage's FreeIPA vendor uses `ipaUniqueID`) and disabled markers such as `nsAccountLock`. Out of scope, not verified.
- Whether `ldapts` bundles cleanly under Next 16 / Turbopack without `serverExternalPackages`. Not built.

---

## Sources (pinned)

Libraries and code:

- ldapts tag v9.2.0 = `ldapts/ldapts@b38cfc3ecfa71ebd59ddfcf2f7d49887ae84fad2` (README.md; src/Client.ts; src/messages/{BindRequest,SearchEntry,SearchRequest}.ts; src/Attribute.ts; src/StatusCodeParser.ts; src/errors/resultCodeErrors/_; src/filters/{Filter,escapeFilter,EqualityFilter,AndFilter,NotFilter}.ts; src/controls/{Control,PagedResultsControl}.ts; tests/{Client,FilterParser}.test.ts; CHANGELOG.md; .github/workflows/ci.yml; docker-compose.yml). main = `e670417788d7841dafd969d0597421db1950e656` (2026-10-08, identical README and src). Local copy: `tmp/b3-research/src/ldapts/` (TypeScript files renamed `_.ts.txt`).
- ldapjs `ldapjs/node-ldapjs@8ffd0bc9c149088a10ec4c1ec6a18450f76ad05d` README.md (decommission note, 2024-05-14); npm `ldapjs` deprecation text.
- next-auth v4 docs `nextauthjs/next-auth@d857eec560fb99c8b18d3b22a2693b849a62d1c3:docs/docs/tutorials/ldap-auth.md`; https://next-auth.js.org/tutorials/ldap-auth-example ; https://next-auth.js.org/configuration/options (JWE in the session cookie).
- n8n `n8n-io/n8n@5b78e8b655452adea7dd0a7199480f2cf773bd35`: packages/cli/package.json:244; packages/cli/src/modules/ldap.ee/{ldap.service.ee.ts,helpers.ee.ts,constants.ts} (copies: `tmp/b3-research/n8n-*.ts.txt`).
- Backstage `backstage/backstage@75128025b788bb70e46553141a9a66f80777116c`: plugins/catalog-backend-module-ldap/{package.json:48, src/ldap/vendors.ts, src/ldap/client.ts} (copies: `tmp/b3-research/backstage-*.ts.txt`).
- ldap-authentication `shaozi/ldap-authentication@5fdb864b65222989ea3721817e4359df3a4c410c:index.js` (copy: `tmp/b3-research/ldap-authentication-index.js.txt`).
- Rocket.Chat `RocketChat/Rocket.Chat@a6ae19882c0ff7b644ae80116c14d7ecf2491265:apps/meteor/package.json:250-251`; LibreChat `danny-avila/LibreChat@e1dfc10449ff713faffacd60273fddcfe2c0a698` (passport-ldapauth); Infisical `Infisical/infisical@b44114a1d97e361d6ac55bac15e4b352da6b823c:backend/package.json:190,278`.
- OWASP Cheat Sheet Series `OWASP/CheatSheetSeries@29994dd8a2e6f50fa3d5607b046b54d7c6945afd`: cheatsheets/LDAP_Injection_Prevention_Cheat_Sheet.md (lines 20, 55-78, 157); cheatsheets/Authentication_Cheat_Sheet.md (lines 150-154).
- npm registry and downloads API, read 2026-10-09 (week 2026-09-28 to 2026-10-04).
- Node.js 22 TLS docs: https://nodejs.org/docs/latest-v22.x/api/tls.md (`tls.connect` options `host`, `socket`, `servername`, `ca`, `rejectUnauthorized`).
- Next.js 16.3.4 bundled docs: node_modules/next/dist/docs/01-app/02-guides/package-bundling.md:252-254.

Standards (rfc-editor.org text):

- RFC 4513 §3.1.3, §5.1, §5.1.1, §5.1.2, §5.1.3, §6.3.1, §6.3.3 — https://www.rfc-editor.org/rfc/rfc4513.txt
- RFC 4511 §4.2.1, §4.5.1.8, result codes — https://www.rfc-editor.org/rfc/rfc4511.txt
- RFC 4512 §3.4 — https://www.rfc-editor.org/rfc/rfc4512.txt
- RFC 4515 §3 — https://www.rfc-editor.org/rfc/rfc4515.txt
- RFC 4530 §1, §2.1, §2.2, §2.4 — https://www.rfc-editor.org/rfc/rfc4530.txt
- RFC 4122 §3, §4.1.2 — https://www.rfc-editor.org/rfc/rfc4122.txt ; RFC 9562 (obsoletes 4122) §4 — https://www.rfc-editor.org/rfc/rfc9562.txt
- RFC 2696 (paged results) — https://www.rfc-editor.org/rfc/rfc2696.txt

Microsoft Learn (fetched 2026-10-09; copies in `tmp/b3-research/ms/`):

- ADSI Search Filter Syntax (BIT_AND, IN_CHAIN, binary escapes) — https://learn.microsoft.com/en-us/windows/win32/adsi/search-filter-syntax
- userAccountControl flags — https://learn.microsoft.com/en-us/troubleshoot/windows-server/active-directory/useraccountcontrol-manipulate-account-properties
- MS-ADTS 2.2.16 userAccountControl Bits — https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-adts/dd302fd1-0aa7-406b-ad91-2a6b35738557
- MS-ADTS 3.1.1.3.4.4.1 BIT_AND — …/ms-adts/6dd1d7b4-2b2f-4e55-b164-7047c4c5bb00 ; 3.1.1.3.4.4.3 TRANSITIVE_EVAL — …/ms-adts/1e889adc-b503-4423-8985-c28d5c7d4887
- MS-ADTS 3.1.1.3.4.1.14 LDAP_SERVER_SHOW_DELETED_OID — …/ms-adts/4b8f2a0e-9ea6-4be3-b639-4b019948c568
- MS-ADTS 3.1.1.3.4.6 LDAP Policies — …/ms-adts/3f0137a1-63df-400c-bf97-e1040f055a99
- MS-ADTS 3.1.1.1.3 objectGUID as identifying attribute — …/ms-adts/dd4dc725-021b-4c8c-a44a-49b3235836b7
- MS-ADTS 5.1.1.1.1 Simple Authentication (name forms) — …/ms-adts/6a5891b8-928e-4b75-a4a5-0e3b77eaca52
- MS-DTYP 2.3.4 / 2.3.4.1 / 2.3.4.2 / 2.3.4.3 GUID — …/ms-dtyp/4926e530-816e-41c2-b251-ec5c7aca018a , …/49e490b8-f972-45d6-a3a4-99f924998d97 , …/001eec5a-7f8b-4293-9e21-ca349392db40 , …/222af2d3-5c00-4899-bc87-ed4c6515e80d
- objectGUID attribute — https://learn.microsoft.com/en-us/windows/win32/adschema/a-objectguid ; Using objectGUID to Bind — https://learn.microsoft.com/en-us/windows/win32/ad/using-objectguid-to-bind-to-an-object
- memberOf — https://learn.microsoft.com/en-us/windows/win32/adschema/a-memberof ; primaryGroupID — https://learn.microsoft.com/en-us/windows/win32/adschema/a-primarygroupid
- LDAP policy (MaxPageSize default 1,000) — https://learn.microsoft.com/en-us/troubleshoot/windows-server/active-directory/view-set-ldap-policy-using-ntdsutil
- Retrieving Deleted Objects — https://learn.microsoft.com/en-us/windows/win32/ad/retrieving-deleted-objects ; Polling for Changes Using uSNChanged — https://learn.microsoft.com/en-us/windows/win32/ad/polling-for-changes-using-usnchanged
- LDAP signing (rejecting cleartext simple binds) — https://learn.microsoft.com/en-us/troubleshoot/windows-server/active-directory/enable-ldap-signing-in-windows-server
- .NET `Guid.ToByteArray` byte order — https://learn.microsoft.com/en-us/dotnet/api/system.guid.tobytearray
- Archived TechNet wiki "Active Directory: LDAP Syntax Filters" (enabled-users filter, GUID example) — https://learn.microsoft.com/en-us/archive/technet-wiki/5392.active-directory-ldap-syntax-filters

Other product docs:

- Apache httpd mod_authnz_ldap, "The Authentication Phase" — https://httpd.apache.org/docs/2.4/mod/mod_authnz_ldap.html#authenphase
- Grafana LDAP, "Bind and bind password" and nested groups — https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/ldap/
- OpenLDAP 2.6 Administrator's Guide — https://www.openldap.org/doc/admin26/guide.html (§12.8; LDAP Sync replication; the monitor chapter on "+")
- slapo-memberof(5), slapo-dynlist(5), slapo-ppolicy(5) for OpenLDAP 2.6-Release — https://www.openldap.org/software/man.cgi?query=slapo-memberof&sektion=5&manpath=OpenLDAP+2.6-Release (and `query=slapo-dynlist`, `query=slapo-ppolicy`)
