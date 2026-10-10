# B3b plan research: Active Directory open points and reference projects

Date: 2026-10-10 (every source read on this date). Scope: the B3b plan's open points from the spec (`docs/superpowers/specs/2026-10-09-backend-b3-groups-access-ldap-design.md` §14) and the design choices the docs leave open (ADR-0002: documented approaches, plus 2 or 3 reference projects pinned to a commit). It builds on `ldap-reference-projects.md`, `ldap-client.md`, `periodic-jobs.md` and ADR-0027's "B3b notes", and reuses their pins where it can.

Method: Microsoft Learn and Microsoft Support pages crawled with `.venv/bin/crwl` (each page's "Last updated" date is given); Docker docs through Context7 (`/docker/docs`), then pinned with `gh api`; reference-project files read with `gh api repos/<o>/<r>/contents/<path>?ref=<sha>` and saved as `.txt` copies under `tmp/b3b-ad-refs/` (git-ignored; no `.ts` or `.tsx` file there); earlier clones under `tmp/b3-research/src/` re-read where they hold the file. The only code run was a TCP probe written for this report, which opened a connection to the local MySQL container and to an unroutable documentation address (A.2). gitlab.com answered 500 or 503 to every API and raw-file request on 2026-10-10, so GitLab's EE-only code (`ee/`) could not be read. GitLab is cited from its CE mirror and its documentation.

Short pins used below (full SHAs in "Pinned sources"): `AU` Authelia `2ed18389`, `SS` Spring Security `126f02bf`, `DAL` django-auth-ldap `3efc4940`, `KC` Keycloak `c7de391a`, `N8` n8n `5b78e8b6`, `MM` Mattermost `4d94455a`, `MMD` Mattermost docs `bd09d959`, `GL` GitLab CE mirror `0739b8bf`, `GF` Grafana `7b702d79`, `BS` Backstage `75128025`, `OW` Open WebUI `8bd8b4fa`, `OL` OpenLDAP `ae910be7`, `LA` ldap-authentication `5fdb864b`, `DOC` Documenso `38ecb217`, `GW` Graphile Worker `4cda192c`, `GJ` GoodJob `30718bb4`, `SQ` Solid Queue `73602fe3`, `HO` Homarr `ad15cfc3`, `DD` docker/docs `18bbfeeb`, `DC` docker/compose `e11dce59`.

---

## A.1 LDAP signing and channel binding on domain controllers

### Verdict

- **Windows Server 2025, new forest or domain:** LDAP signing is **enforced by default**. The DC rejects a simple bind over plain `ldap://` (no TLS). An **in-place upgrade to 2025** keeps an existing signing policy, but if no policy was ever set, 2025 also requires signing.
- **Windows Server 2022, 2019 and earlier:** signing is optional by default. Simple binds over plain `ldap://` are accepted, unless an administrator set **Require signing**.
- **The rejection is LDAP result code 8, `strongerAuthRequired`.** Microsoft's own check of the setting is a plain simple bind in `ldp.exe` on port 389, which must fail with "Strong Authentication Required". Microsoft's LDAP return-code list maps that text to `LDAP_STRONG_AUTH_REQUIRED` (0x08). In ldapts this is `StrongAuthRequiredError` (`ldap-client.md` §3.9).
- **Channel binding (EPA/CBT) does not affect simple binds over LDAPS or StartTLS,** whatever its setting, "Always" included. Microsoft states that channel binding applies only to SASL binds inside TLS. For TLS with a simple bind, `LdapEnforceChannelBinding` "has no bearing", and the signing requirement "is met because the TLS channel provides signing". Node's TLS client sends no CBT, and that does not matter here.
- **Channel binding defaults:** 2025 "When supported" (clients without CBT are still accepted); 2022 and earlier "Never".

### What this means for the owner

1. `LDAP_ENCRYPTION=none` keeps working only while the DC's signing policy allows unsigned binds. It stops on a new 2025 domain, after the administrator sets **Require signing**, and **after an in-place upgrade of an unconfigured DC to 2025**. When that happens, the service-account bind fails with code 8 before any user is looked up.
2. **Gap in spec §7.3:** `DirectoryUnavailable` is listed only for connection, timeout and TLS failures. A code-8 or code-13 (`confidentialityRequired`) answer is a `ResultCodeError`. If the code treats every `ResultCodeError` as "the directory answered" and so as a credential failure, a signing-enforcing DC shows every user "Check your username and password". Recommendation:
   - only `InvalidCredentialsError` (49) on the **user** bind becomes `CredentialsSignin`;
   - any failure of the **service** bind, and codes 8 and 13 anywhere, become `DirectoryUnavailable`, with fixed log codes such as `directory_tls_required` and `service_bind_failed`;
   - the sync records `failed` with the same `error_code`.
3. **Moving to `ldaps` (or `starttls`):**
   - The DC needs a certificate with Server Authentication EKU whose subject CN or a DNS SAN is the DC's **FQDN**. "There's no user interface for configuring LDAPS"; installing the certificate is enough.
   - The hub then uses `ldaps://<dc-fqdn>:636` with the enterprise root CA in `LDAP_CA_FILE`.
   - A URL by IP fails Node's identity check unless the certificate carries that IP as a SAN. Node's `checkServerIdentity` takes "The host name or IP address to verify the certificate against".
   - If Docker's DNS cannot resolve the FQDN, Compose's documented `extra_hosts` (`- "dc01.corp.example=10.0.0.5"`) maps it.
   - LDAPS and StartTLS meet the signing requirement, and channel binding does not apply (above).

### Quotes

- "Windows Server 2025 or later requires LDAP signing by default for new Active Directory deployments." / "**Domain controller: LDAP server signing requirements enforcement**: enabled by default on new deployments. When enabled, it enforces signing and takes precedence over the signing-level policy." / "**No server policy set**: if no LDAP server signing policy exists, Windows Server 2025 requires LDAP signing by default." / Windows Server 2022 or earlier: "**LDAP server signing**: optional by default; domain controllers accept both signed and unsigned LDAP binds." / "When you enforce LDAP signing on a domain controller, it rejects SASL LDAP binds that don't request signing and rejects simple binds over unencrypted connections." / "LDAP signing doesn't protect **simple binds** … use TLS to protect them in transit." Source: Microsoft Learn, "LDAP signing for Active Directory Domain Services", https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/ldap-signing (applies to 2025, 2022, 2019, 2016; last updated 2026-10-02).
- "LDAP channel binding applies … only to **TLS-secured sessions that use Simple Authentication and Security Layer (SASL) authentication**." / "Channel binding doesn't apply to the following session types: **Simple bind over TLS.** LDAP signing and CBT don't protect simple binds." / Defaults: Windows Server 2025, "**Channel binding policy**: Defaults to **When supported**. Domain controllers accept channel binding when clients provide it but don't reject clients that don't support CBT"; 2022 or earlier, "Set to **Never**". / Scenario table: "LDAPS + Simple Bind | TLS | TLS | None. Simple binds don't use CBT." Source: Microsoft Learn, "LDAP channel binding for AD DS", https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/ldap-channel-binding (last updated 2026-10-02).
- "LDAP sessions using TLS/SSL and simple bind for user authentication. There's no CBT information added for these sessions. … The requirement for **LDAPServerIntegrity** is met because the TLS channel provides signing. … The **LdapEnforceChannelBinding** setting has no bearing on this session option." TLS sessions include "standard ports (389, 3268, or a custom LDS port) that use the STARTTLS extended operation". And: "Sessions on ports 389 … that don't use TLS/SSL for a simple bind: There's no security for these sessions … These sessions should be disabled by setting **LDAPServerIntegrity** to **Required**." Source: Microsoft Learn, "LDAP session security settings and requirements after ADV190023", https://learn.microsoft.com/en-us/troubleshoot/windows-server/active-directory/ldap-session-security-settings-requirements-adv190023 (last updated 2026-02-12).
- How Microsoft verifies the setting: in `ldp.exe`, connect to "the non-SSL/TLS port of your directory server" (389), select **Simple bind**, and "If you receive the following error message, you have successfully configured your directory server: Ldap_simple_bind_s() failed: Strong Authentication Required". Source: Microsoft Learn, "How to enable LDAP signing in Windows Server", https://learn.microsoft.com/en-us/troubleshoot/windows-server/active-directory/enable-ldap-signing-in-windows-server (last updated 2026-02-12).
- "**LDAP_STRONG_AUTH_REQUIRED** 0x08 Strong authentication is required." / "**LDAP_CONFIDENTIALITY_REQUIRED** 0x0d Confidentiality is required." / "**LDAP_INVALID_CREDENTIALS** 0x31 The supplied credential is invalid." Source: Microsoft Learn (archived), "Return Values" (Winldap.h), https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ldap/return-values (`ms.date` 2018-05-31).
- KB4520412: "**Important**: The March 10, 2020 updates, and updates in the foreseeable future, will not change LDAP signing or LDAP channel binding default policies or their registry equivalent on new or existing Active Directory domain controllers." The August 2023 and October 2023 updates "did not change" them either. Source: Microsoft Support, "2020, 2023, and 2024 LDAP channel binding and LDAP signing requirements for Windows (KB4520412)", https://support.microsoft.com/en-us/topic/2020-2023-and-2024-ldap-channel-binding-and-ldap-signing-requirements-for-windows-kb4520412-ef185fb8-00f7-167d-744c-f299a66fc00a (updated 2025-01-03). So the patches never changed the defaults for existing DCs; the 2025 default came with the new OS.
- "What's new in Windows Server 2025": "**LDAP encryption by default**: All new Active Directory deployments require LDAP signing (sealing) by default for all LDAP client communication after a Simple Authentication and Security Layer (SASL) bind." https://learn.microsoft.com/en-us/windows-server/get-started/whats-new-windows-server-2025 (last updated 2026-01-15).
- LDAPS certificate: "The Enhanced Key Usage extension includes the Server Authentication (1.3.6.1.5.5.7.3.1) object identifier" and "The Active Directory fully qualified domain name of the domain controller (for example, dc01.contoso.com) must appear in one of the following places: The Common Name (CN) in the Subject field. DNS entry in the Subject Alternative Name extension." And: "There's no user interface for configuring LDAPS. Installing a valid certificate on a domain controller permits the LDAP service to listen for, and automatically accept, SSL connections". Source: Microsoft Learn, "Enable LDAP over SSL with a third-party certification authority", https://learn.microsoft.com/en-us/troubleshoot/windows-server/active-directory/enable-ldap-over-ssl-3rd-certification-authority (last updated 2026-02-12).
- MS-ADTS 5.1.1.1.1: "Active Directory does not require, but supports, the use of an SSL/TLS-encrypted or otherwise protected connection when performing a simple bind." (copy in `tmp/b3-research/ms/adts-6a5891b8-….md`).
- Compose `extra_hosts`: "`extra_hosts` adds hostname mappings to the container network interface configuration (`/etc/hosts` for Linux)", short syntax `"somehost=162.242.195.82"` (`DD:content/reference/compose-file/services.md:974-987`).

### Not confirmed

- The owner's DC version and its current `LDAPServerIntegrity` value. They decide whether `none` works today. The owner's live check, or Event ID 2886/2887 on the DC ("the domain controller (DC) doesn't reject unsigned SASL binds or clear-text simple binds"), would show it.
- That AD answers code 8 and not 13. This is inferred from two Microsoft pages: the `ldp` message on one, the code table on the other. No Microsoft sentence names the code for this case.
- The 2025 "What's new" wording ("after a SASL bind") is narrower than the LDAP signing page ("rejects simple binds over unencrypted connections"). This report follows the more specific and more recent signing page (2026-10-02).

---

## A.2 Reaching the domain controller from a container on the owner's machine

### Verdict

- **The owner runs Docker Desktop with the WSL 2 backend, not Docker Engine inside the distribution.** Read on this machine: `docker info` reports `Docker Desktop | 29.3.1`. `wslinfo --networking-mode` prints `nat`. `.wslconfig` sets no `networkingMode`.
- **With Docker Desktop, WSL's NAT or mirrored mode does not decide whether a container reaches the LAN.** Docker documents that container egress goes through a shared-memory channel to `com.docker.backend.exe` on Windows, which "creates standard TCP/IP connections using the same networking APIs as other applications". A container reaches `10.x.x.x:389` exactly when Windows itself can (Windows firewall, VPN, endpoint security, routing).
- **For Docker Engine installed directly inside a WSL distribution** (not this machine): bridge containers reach outside hosts by masquerading through the Linux host. Under WSL's default NAT the Linux host goes through Windows' NAT. Microsoft recommends mirrored mode for "Improved networking compatibility for VPNs"; it is opt-in and needs Windows 11 22H2 or later.
- **A one-line check from inside the hub's own container** (same image and Compose network as the real sign-in; Node's documented `net.connect` with its `timeout` option). It prints `open`, `timeout`, or `error <code>` (for example `ECONNREFUSED`):

  ```bash
  docker compose -f docker-compose.local.yml exec -T app node -e "const s=require('node:net').connect({host:process.argv[1],port:Number(process.argv[2]),timeout:5000});s.on('connect',()=>{console.log('open');s.destroy()}).on('timeout',()=>{console.log('timeout');s.destroy()}).on('error',e=>console.log('error',e.code))" <DC-IP> 389
  ```

  Checked on this machine on 2026-10-10: `mysql 3306` printed `open`, and `192.0.2.1 389` (an unroutable documentation address) printed `timeout`. It needs the app container running. When the stack is down, `docker compose -f docker-compose.local.yml run --rm --no-deps --entrypoint node app -e "…" <DC-IP> 389` runs the same check in a throwaway container. `--rm`, `--no-deps` and `--entrypoint` are documented `run` options, and `--entrypoint` skips the image's migration entrypoint. `open` proves only TCP. The LDAP bind itself is the owner's live check (spec §9).

### Quotes

- Docker Desktop: "Outbound traffic from the container is sent through Network Address Translation (NAT) using a virtual adapter … The traffic is transferred to the host system over a shared-memory channel rather than through a traditional virtual network interface. … On the host, Docker Desktop's backend process receives the traffic and creates standard TCP/IP connections using the same networking APIs as other applications." / "All outbound container network traffic originates from the `com.docker.backend` process. Firewalls, VPNs, and security tools, like CrowdStrike, see traffic coming from this process". The setup table lists "Windows (WSL 2) | WSL 2 | `com.docker.backend.exe` | …" for networking (`DD:content/manuals/desktop/features/networking/_index.md:30-49`; Context7 `/docker/docs` returned the same text).
- Docker Engine: "Containers have networking enabled by default, and they can make outgoing connections." / "Containers attached to the default bridge have access to network services outside the Docker host. They use "masquerading" which means, if the Docker host has Internet access, no additional configuration is needed" (`DD:content/manuals/engine/network/_index.md:23-40`).
- WSL: "By default WSL uses a NAT based architecture, and we recommend trying the new Mirrored networking mode to get the latest features and improvements." / Mirrored mode: "On machines running Windows 11 22H2 and higher you can set `networkingMode=mirrored` under `[wsl2]` in the `.wslconfig` file … Here are the current benefits … Improved networking compatibility for VPNs … Connect to WSL directly from your local area network (LAN)". Microsoft Learn, "Accessing network applications with WSL", https://learn.microsoft.com/en-us/windows/wsl/networking (last updated 2025-08-06).
- `docker compose run`: "`--entrypoint` … Override the entrypoint of the image", "`--no-deps` … Don't start linked services", "`--rm` … Automatically remove the container when it exits" (`DC:docs/reference/compose_run.md:67,73,81`).

### Not confirmed

- Whether a Windows firewall rule, a VPN client or endpoint security on the owner's machine blocks `com.docker.backend.exe` from reaching the DC's subnet. Not checked. The probe above shows it either way.
- Whether Docker Engine inside a WSL distribution in NAT mode reaches a LAN host behind a Windows VPN. Not tested; not this machine's setup.

---

## B.3 Unknown username in search-then-bind: same time as a wrong password

### Verdict

**Use a minimum response time on every directory sign-in that fails (Authelia's shape). Do not use a dummy bind.**

- Of the surveyed LDAP implementations, **none** binds to a dummy DN when the search finds nothing:
  - Spring Security's `BindAuthenticator`, django-auth-ldap, `ldap-authentication`, n8n, Apache `mod_authnz_ldap` and Authelia's LDAP provider all return at once;
  - the "same work" trick exists only for **local** password hashes: Keycloak's `dummyHash`, Spring's `DaoAuthenticationProvider` `mitigateAgainstTimingAttack`, and the hub's own `UNKNOWN_ACCOUNT_HASH` in `lib/auth/options.ts:33-37`.
- **Authelia** equalises at the HTTP handler instead. Every first-factor answer, successful or not, is padded to the moving average of the last 10 successful sign-ins (initially 1 s), with a 250 ms floor and 0–85 ms random jitter.
- **A dummy bind would be harmless but would not equalise timing on AD:**
  - it fails the same way as a wrong password. MS-ADTS: a name that maps to no object fails "with the error invalidCredentials"; OpenLDAP's `back-mdb` returns `LDAP_INVALID_CREDENTIALS` when the DN is not found;
  - with no object, there is no account whose bad-password count could rise;
  - but Microsoft documents that a DC forwards a **wrong password** for an existing user to the PDC emulator before failing it. An unknown name involves no such round trip, so in a multi-DC domain the two paths still take different times.
- **Recommended for the hub:** a small pure helper in `lib/directory/`, unit-testable with fake timers:
  - measure `authorize` with `performance.now()`;
  - on every refusal, including unknown user, ambiguous match, wrong password, deactivated account, missing email and email collision, wait the remainder up to a floor with `await setTimeout(ms)` from `node:timers/promises`;
  - the floor is either Authelia's moving average of recent successful directory sign-ins (minimum 250 ms, jitter 0–85 ms, kept in process memory), or a fixed constant set above the slowest wrong-password bind measured in the owner's live check;
  - `DirectoryUnavailable` needs no padding: it reveals nothing about the account.
- **Same rule on the local tab:** when the local provider refuses an `ldap` account (no password, spec §6.3), it still runs the existing dummy bcrypt. Otherwise the local tab tells directory accounts apart by time.

### Quotes and pinned code

- OWASP Authentication Cheat Sheet, "Authentication Responses": "depending on the implementation, the processing time can be significantly different according to the case (success vs failure) allowing an attacker to mount a time-based attack" and, for the quick-exit pseudo-code, "if the user doesn't exist, the application will directly throw an error … the response time will be different for the same error" (`OWASP/CheatSheetSeries@29994dd8:cheatsheets/Authentication_Cheat_Sheet.md:160-190`, copy `tmp/b3-research/owasp-authn.md`).
- **Authelia:**
  - `NewTimingAttackDelay` defaults `minDelayMs: 250, maxJitterMs: 85, successDelay: true, jitter: true` (`AU:internal/middlewares/timing_attack_delay.go:36-53`);
  - the struct is documented as "used to prevent timing attacks by introducing a delay relative to a moving average of past request durations" (`:55-57`);
  - only successful, non-cached durations update the average (`:150-153`);
  - the delay is `math.Max(execDurationAvgMs, minDelayMs) + jitter - elapsed` (`:171-172`), then `time.Sleep` (`:136`);
  - the handler is wired as `delayerPassword := middlewares.NewTimingAttackDelay(10, time.Second).SetRecord(true)` and `r.POST("/api/firstfactor", … FirstFactorPasswordPOST(delayerPassword))` (`AU:internal/server/handlers.go:265-267`), with `defer delayer.Delay(ctx, requestTime, &successful)` (`AU:internal/handlers/handler_firstfactor_password.go:26-27`);
  - the LDAP provider itself returns at once when the profile search fails: `if profile, err = p.getUserProfile(client, username); err != nil { return false, err }` (`AU:internal/authentication/ldap_user_provider.go:104-106`; `ErrUserNotFound` at `:464,536`).
- **Keycloak** (local users): `testInvalidUser` calls `AuthenticatorUtils.dummyHash(context)` when `user == null` (`KC:services/src/main/java/org/keycloak/authentication/authenticators/browser/AbstractUsernameFormAuthenticator.java:118-125`). The method's comment: "This method exists to simulate hashing of some "dummy" password. The purpose is to make the user enumeration harder, so the authentication request with non-existing username also need to simulate the password hashing overhead" (`KC:services/src/main/java/org/keycloak/authentication/authenticators/util/AuthenticatorUtils.java:69-86`).
- **Spring Security:**
  - LDAP: `searchForUser` throws `UsernameNotFoundException.fromUsername(username)` when `ex.getActualSize() == 0` (`SS:ldap/src/main/java/org/springframework/security/ldap/search/FilterBasedLdapUserSearch.java:95-107`), and `BindAuthenticator.authenticate` binds only with the DN it found (`SS:ldap/src/main/java/org/springframework/security/ldap/authentication/BindAuthenticator.java:87-98`). Neither has a timing step;
  - DAO (local): `catch (UsernameNotFoundException ex) { mitigateAgainstTimingAttack(authentication); …` matches the presented password against `userNotFoundEncodedPassword` (`SS:core/src/main/java/org/springframework/security/authentication/dao/DaoAuthenticationProvider.java:104-114,146-157`).
- **Quick exits elsewhere:**
  - django-auth-ldap: `if self.dn is None: raise self.AuthenticationFailed("failed to map the username to a DN.")` (`DAL:django_auth_ldap/backend.py:484-490`);
  - n8n: `if (!searchResult.length) { return undefined; }` (`N8:packages/cli/src/modules/ldap.ee/ldap.service.ee.ts:330-332`);
  - ldap-authentication: `user = null` for no entries, then `AUTH_RESULT_FAILURE_IDENTITY_NOT_FOUND` (`LA:index.js:228-234,505-514`);
  - Apache: "If the search does not return exactly one entry, deny or decline access." (`tmp/b3-research/apache-mod_authnz_ldap.md`).
- **Dummy bind results:**
  - AD: "If the name field of the BindRequest maps to no object, the next object name form is tried; if all forms have been tried, the BindRequest fails with the error invalidCredentials / ERROR_INVALID_PARAMETER." (MS-ADTS 5.1.1.1.1, https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-adts/6a5891b8-928e-4b75-a4a5-0e3b77eaca52);
  - OpenLDAP: `case MDB_NOTFOUND: rs->sr_err = LDAP_INVALID_CREDENTIALS; goto done;` (`OL:servers/slapd/back-mdb/bind.c:69-74`).
- **PDC forwarding:** "By default, when a user password is reset or changed, or when a domain controller receives a client authentication request using an incorrect password, the Windows domain controller acting as the PDC Flexible Single Master Operation (FSMO) role owner for the Windows domain is contacted." and "By default, Windows domain controllers query the PDC FSMO role owner if a user is attempting to authenticate using a password that is incorrect according to its local database." Microsoft Learn, "Password change processing and conflict resolution functionality", https://learn.microsoft.com/en-us/troubleshoot/windows-server/identity/password-change-processing-conflict-resolution-function.
- Node 22: "`timersPromises.setTimeout([delay[, value[, options]]])` … `delay` The number of milliseconds to wait before fulfilling the promise." https://nodejs.org/docs/latest-v22.x/api/timers.html.

### Not confirmed

- That an LDAP **simple bind** with a wrong password triggers the PDC forward. Microsoft's page speaks of "a client authentication request using an incorrect password" generally, not of LDAP binds specifically.
- Actual timings on the owner's directory (unknown name, wrong password, success). The live check should log them so the floor can be set. Authelia's mechanism is documented in its code, not in its user docs.

---

## B.4 Sync run history and "Sync now" in the admin UI

### Verdict

The spec's `directory_sync_runs` row (§3.2) records the same counts as n8n and Mattermost, and more outcomes. Both record and show history as the spec plans, and none of them adds what the spec lacks. Specific points for the plan:

- **A row that exists while the run is going** (the spec's `running`) is Mattermost's model: a job is `pending`, then claimed by an optimistic `pending → in_progress` update, then `success`, `warning`, `error` or `canceled`. n8n writes its row only **after** the run, so a running sync is invisible, and a failed search writes **no row at all** (it throws before `saveLdapSynchronization`). The spec's start-of-run row is the better precedent.
- **Show the error, the counts and the next run:**
  - Mattermost's table shows Status, Finish Time, Run Time and Details. Details is the job's `error` text when there is one, else "Scanned N LDAP users … Updated N users. Deactivated N users.";
  - n8n shows Status, Ended At, Run Mode, Run Time and Details ("Users scanned N");
  - Grafana shows "Next synchronization" and "Scheduled" for LDAP (and "Next scheduled synchronization" on each user);
  - the spec's panel (§6.6) matches Grafana's, plus Mattermost's counts. Show `error_code` through a translation key; never raw text (spec §7.3).
- **Guarding a manual run against one in flight:**
  - Keycloak runs every sync, scheduled or manual, through a cluster-wide `executeIfNotExecuted(provider.getId()+"::sync", max(30 s, period))` and answers "Synchronization ignored as it's already in progress";
  - Mattermost's store has `SaveOnce`: a serializable transaction that counts `pending`/`in_progress` jobs of that type and inserts only at 0. Its "AD/LDAP Synchronize Now" goes through plain `CreateJob`, and its scheduler runs only on the cluster leader;
  - GitLab's docs warn against overlap instead of preventing it: "Do not run the sync process too frequently as this could lead to multiple syncs running concurrently";
  - n8n has no guard, and neither does its `setInterval` schedule.
  - **Recommendation:** apply the spec's "refused while a run younger than 30 minutes has no `finished_at`" check to scheduled and startup claims too, not only to manual runs, as Keycloak's one key does for both. A scheduled slot that finds a run in flight is recorded and skipped. The spec's idempotence argument remains the fallback.
- **Retention:**
  - Mattermost keeps jobs forever by default (`JobSettings.CleanupJobsThresholdDays` default `-1`, "Must be set to a value greater than or equal to `0` to be enabled");
  - n8n never prunes; only `n8n ldap:reset` deletes the history;
  - the spec's 90-day deletion is stricter than both, and no reference contradicts it.
- **After a manual run:** Mattermost documents "Following a manual sync, the next sync will occur after the time set in the **Synchronization Interval**". With a cron schedule (the hub's), the next run stays at the next cron time, which is simpler. Show it with croner's `nextRun()`.

### Quotes and pinned code

- **n8n:**
  - entity `AuthProviderSyncHistory`, table `auth_provider_sync_history` (not `ldap_sync_history`), columns `id, providerType, runMode, status, startedAt, endedAt, scanned, created, updated, disabled, error` (`N8:packages/@n8n/db/src/entities/auth-provider-sync-history.ts:6-40`; migration `packages/@n8n/db/src/migrations/common/1674509946020-CreateLdapEntities.ts:44`); `RunningMode = 'dry' | 'live'`, `SyncStatus = 'success' | 'error'` (`N8:packages/@n8n/db/src/entities/types-db.ts:389-391`);
  - schedule `this.syncTimer = setInterval(async () => { await this.runSync('live'); }, this.config.synchronizationInterval * 60000);` (`ldap.service.ee.ts:371-378`);
  - in `runSync`, the search runs before `startedAt` is set (`:396-422`), errors are rethrown with no history row (`:406-420`), `endedAt` is taken before `processUsers` (`:457`), and the row is saved at the end (`:470-480`);
  - REST `GET /sync` (paged) and `POST /sync` → `runSync(req.body.type)` (`ldap.controller.ee.ts:59-72`); paging `order: { id: 'DESC' }, skip, take` (`helpers.ee.ts:270-296`);
  - UI: columns Status, "Ended At", "Run Mode", "Run Time", "Details" (`packages/frontend/editor-ui/src/features/settings/sso/views/SettingsLdapView.vue:704-733`); buttons "Test synchronization" (dry) and "Run synchronization" (`:744-755`; labels `packages/frontend/@n8n/i18n/src/locales/en.json:5871-5881`);
  - `ldap:reset` deletes the history: `Container.get(AuthProviderSyncHistoryRepository).delete({ providerType: 'ldap' })` (`packages/cli/src/commands/ldap/reset.ts:124`).
- **Mattermost:**
  - "Sync History" section, button "AD/LDAP Synchronize Now", help "Initiates an AD/LDAP synchronization immediately. See the table below for status of each synchronization." (`MM:webapp/channels/src/components/admin_console/admin_definition_ldap_wizard.tsx:655-666`); counts rendered per job ("Scanned {ldapUsers, number} LDAP users …", "Updated {updateCount, number} users.", "Deactivated {deleteCount, number} users.", `:680-760`);
  - job table: the error shown first (`if (job.data && job.data.error …) return <span title={job.data.error}>{job.data.error}</span>`, `webapp/channels/src/components/admin_console/jobs/table.tsx:64-74`), headers Status, Finish Time, Run Time, Details (`:255-290`); statuses Pending, In Progress, Success, Warning, Error, Canceling…, Canceled (`jobs/job_status.tsx:17-93`);
  - server: `CreateJob` vs `CreateJobOnce` (`server/channels/jobs/jobs.go:38-62`); claim `UpdateStatusOptimistically(job.Id, model.JobStatusPending, model.JobStatusInProgress)` (`:113-125`); `SaveOnce` counts `Status IN (pending, in_progress)` for the type in a `sql.LevelSerializable` transaction and returns without inserting when `count > 0` (`server/channels/store/sqlstore/job_store.go:81-135`); the scheduler acts only `if … schedulers.isLeader` (`server/channels/jobs/schedulers.go:85-95`);
  - defaults `SyncIntervalMinutes = new(60)` and `CleanupJobsThresholdDays = new(-1)` (`server/public/model/config.go:2893-2894,3579-3580`);
  - docs: "Use the **AD/LDAP Synchronize Now** button to immediately revoke a session after disabling an AD/LDAP account." and "Following a manual sync, the next sync will occur after the time set in the **Synchronization Interval**." (`MMD:source/administration-guide/configure/authentication-configuration-settings.rst:1063,1113-1124`); "Clean up old database jobs … Must be set to a value greater than or equal to `0` to be enabled. Default value is **-1**" (`MMD:…/configure/experimental-configuration-settings.rst:1668-1682`).
- **Keycloak:** `String taskKey = provider.getId() + "::sync";` / `int timeout = Math.max(TASK_EXECUTION_TIMEOUT, period);` / `clusterProvider.executeIfNotExecuted(taskKey, timeout, …)` / `if (result == null || !task.isExecuted()) { … return SynchronizationResult.ignored(); }` (`KC:model/storage-private/src/main/java/org/keycloak/storage/UserStorageSyncTask.java:159-188`, `TASK_EXECUTION_TIMEOUT = 30` at `:25`); "Synchronization ignored as it's already in progress" (`KC:server-spi/src/main/java/org/keycloak/storage/user/SynchronizationResult.java:95-98`); the period guard `isSyncPeriod` from `lastSync` (`UserStorageSyncTask.java:213-225`).
- **Grafana:** LDAP page rows "Active synchronization", "Scheduled", "Next synchronization" (`GF:public/app/features/admin/ldap/LdapSyncInfo.tsx:12-29`); per user "User synced via LDAP. Some changes must be done in LDAP or mappings." and "Next scheduled synchronization" (`GF:public/app/features/admin/UserLdapSyncInfo.tsx:40-64`).
- **GitLab** (docs, from the CE mirror):
  - "By default, GitLab runs a worker once per day at 01:30 AM server time … Do not run the sync process too frequently as this could lead to multiple syncs running concurrently." (`GL:doc/administration/auth/ldap/ldap_synchronization.md:1011-1016`);
  - "All users are blocked if the LDAP server is unavailable when an LDAP user synchronization is run." (`:200`);
  - logs only, no history UI: "If a user account is blocked or unblocked due to the LDAP configuration, a message is logged to `application_json.log`. If there is an unexpected error during an LDAP lookup … a message is logged to `production.log`." (`GL:doc/administration/auth/ldap/ldap-troubleshooting.md:871-877`).

### Not confirmed

- GitLab's EE `LdapSyncWorker` and any exclusive lease in it (gitlab.com unreachable, see Method). Mattermost's EE LDAP sync worker is closed source, so whether it refuses a second in-progress LDAP job is unknown.

---

## B.5 A pure "plan" step separated from IO

### Verdict

**A pure plan in the middle fits the references, and the spec already names it (`planSync()`, §8).**

- **n8n** does it in three steps:
  1. IO: one search;
  2. pure: `getUsersToCreate`, `getUsersToUpdate` and `getUsersToDisable`, each a filter over (remote entries, local ids);
  3. IO: `processUsers` applies the three lists in **one transaction**.
- **Backstage** reads and transforms per entry (`readLdapOrg`: users, groups, then `resolveOrgRelations` in memory), then hands the whole desired state to the catalog with `applyMutation({ type: 'full', … })`. The catalog engine computes the diff.
- **Keycloak** reports results as counters (`added`, `updated`, `removed`, `failed`, `ignored`), like the spec's counts.

Two lessons from what they lack:

1. **Neither n8n nor Backstage has an empty-result or partial-result stop in that path.** With n8n, an empty but error-free search makes `getUsersToDisable` return every local LDAP id. Keep the spec's three safety stops inside `planSync()`, so they are unit-tested as plan outcomes ("stop: empty", "stop: id_attribute_changed") and not as IO checks.
2. **Take the plan's inputs as plain data:** directory entries already canonicalised (key, login, email, name), plus the hub accounts' (id, key, attribute, markers, email). `planSync()` then returns the deactivations, reactivations, updates, conflicts, membership adds and removes, or a stop. The apply step runs the result in one transaction, as n8n's `processUsers` does.

### Pinned code

- n8n: `const { usersToCreate, usersToUpdate, usersToDisable } = this.getUsersToProcess(processableAdUsers, localAdUsers);` (`N8:packages/cli/src/modules/ldap.ee/ldap.service.ee.ts:430-433`); the three pure filters, e.g. `getUsersToDisable(remoteAdUsers, localLdapIds) { const remoteAdUserIds = remoteAdUsers.map(…); return localLdapIds.filter((user) => !remoteAdUserIds.includes(user)); }` (`:506-572`); `filterEmailDuplicates` drops entries that share an email ("Prevents the sync from linking or creating ambiguous identities", `:521-546`); apply in one transaction: `await dbManager.transaction(async (transactionManager) => { return await Promise.all([...toCreateUsers.map(…), …` (`N8:packages/cli/src/modules/ldap.ee/helpers.ee.ts:170-200`). Do not copy n8n's linking of an existing email account during sync (`:180-199`, "link the existing user to the LDAP identity"), which spec §7.2 forbids.
- Backstage: `read()` → `LdapClient.create(…)` → `readLdapOrg(…)` → `this.connection.applyMutation({ type: 'full', entities: [...users, ...groups].map(…) })` (`BS:plugins/catalog-backend-module-ldap/src/processors/LdapOrgEntityProvider.ts:274-317`); `readLdapOrg` "Invokes the above "raw" read functions and stitches together the results with all relations etc filled in" (`BS:plugins/catalog-backend-module-ldap/src/ldap/read.ts:300-340`); `resolveOrgRelations` (`…/ldap/relations.ts:182`).
- Keycloak: fields `ignored, added, updated, removed, failed` and `getStatus()` "%d imported users, %d updated users", ", %d removed users", ", %d users failed sync! See server log for more details" (`KC:server-spi/src/main/java/org/keycloak/storage/user/SynchronizationResult.java:25-30,95-108`).

### Not confirmed

- Whether Backstage's catalog refuses a `full` mutation with zero entities (the engine is outside the LDAP module; not read).

---

## B.6 Directory accounts in the admin users UI

### Verdict

The spec's design (§5, §6.3) has a source column, read-only name and email, no password field, and a delete warning. All three references support it:

- **Source shown in the list:**
  - Grafana: an "Origin" column with a badge from `authLabels[0]` (for example "LDAP");
  - GitLab: an "LDAP" info badge, and a separate "LDAP Blocked" danger badge;
  - Mattermost: the user page's "Authentication Method" row, and "(Managed By LDAP)" beside the activation controls.
- **Directory-owned fields read-only:**
  - Grafana locks name, email, username and password for external users, each with "Synced via LDAP";
  - Mattermost disables username, email and name with the tooltip "Managed by login provider – This username is managed by the LDAP login provider and cannot be changed here.";
  - GitLab marks synced attributes read-only through `user_synced_attributes_metadata`, with "…was automatically set based on your %{provider_label} account".
- **Password:**
  - Grafana locks the admin password row for external users;
  - GitLab's admin form still shows password fields for LDAP users, though those users cannot sign in with a password on the web;
  - the spec's "no password field" matches Grafana.
- **Activation:**
  - Mattermost **disables Activate and Deactivate** for AD/LDAP users in the admin UI: the directory alone owns the state;
  - GitLab keeps an admin block apart from `ldap_blocked`, which is the spec's two-marker design (§2 #12, decided).
  - The difference is only worth knowing; it is not an argument to change the spec.
- **Delete warning:** none of the three warns that the person comes back as a new account. The spec's warning (§6.3) goes beyond them and fits ADR-0026, since a new account means a new Dify history.

### Pinned code

- **Grafana:**
  - `let authSource = user.authLabels?.length && user.authLabels[0]; … const lockMessage = authSource ? \`Synced via ${authSource}\` : '';`;
  - `const editLocked = user.isExternal || user.isProvisioned || …`;
  - `const passwordChangeLocked = user.isExternal || user.isProvisioned || …` (`GF:public/app/features/admin/UserProfile.tsx:75-86`), applied to Name, Email, Username and Password (`:104-131`);
  - list column `{ id: 'authLabels', header: 'Origin', cell: … <TagBadge label={value[0]} … /> }` and the "Disabled" tag (`GF:public/app/features/admin/Users/UsersTable.tsx:165-181`);
  - the server sets `userProfile.AuthLabels`, `IsExternal` and `IsExternallySynced` (`GF:pkg/api/user.go:88-99`).
- **Mattermost:**
  - username field `disabled={true} readOnly={true}` with "This username is managed by the {authService} login provider and cannot be changed here." (`MM:webapp/channels/src/components/admin_console/system_user_detail/system_user_detail.tsx:1081-1099`); email the same (`:1140-1165`);
  - "Authentication Method" row (`:1264-1272`);
  - `toggleOpenModalDeactivateMember` returns for `Constants.LDAP_SERVICE` (`:1781-1786`); Activate and Deactivate buttons `disabled={this.state.user?.auth_service === Constants.LDAP_SERVICE}` (`:1946-1961`); "(Managed By LDAP)" (`:1853-1864`);
  - docs: "the following user attribute changes can't be made through the API: first name, last name, position, nickname, email, profile picture, or username" (`MMD:source/administration-guide/onboard/ad-ldap.rst:111`, from `ldap-reference-projects.md`).
- **GitLab:**
  - `badges << { text: s_('AdminUsers|LDAP'), variant: 'info' } if user.ldap_user?` and `ldap_blocked_badge = { text: s_('AdminUsers|LDAP Blocked'), variant: 'danger' }` (`GL:app/helpers/users_helper.rb:130-146,331-339`);
  - `SYNCABLE_ATTRIBUTES = %i[name email location organization job_title]`, `def read_only?(attribute) sync_profile_from_provider? && synced?(attribute) end` (`GL:app/models/user_synced_attributes_metadata.rb:8-22`), used through `User#read_only_attribute?` (`GL:app/models/user.rb:2728-2730`) and `readonly: @user.read_only_attribute?(:job_title)` (`GL:app/views/user_settings/profiles/show.html.haml:95-112`);
  - admin password fields shown for existing users (`GL:app/views/admin/users/_password_fields.html.haml:7-17`).

### Not confirmed

- What Mattermost's admin "Reset Password" (enabled for every account except magic-link ones, `system_user_detail.tsx:~1915-1925`) does to an AD/LDAP account. Not traced.

---

## B.7 Linking a hub group to directory groups from an admin form

### Verdict

**Store the group's id attribute (`objectGUID`/`entryUUID`) with a display name, as Mattermost does and as the spec plans (§6.5).**

| Project | How the admin finds the group | What is stored |
| --- | --- | --- |
| Grafana Team Sync | No search: the admin types the group's **DN** into "Add group" | the DN |
| GitLab | Types "the CN of the group", gets "a dropdown list with matching CNs in the configured `group_base`" | `ldap_group_links.cn` (the **CN**, or a filter) |
| Mattermost | Pages through the directory's groups (200 per page), searches with free text on Enter or the Search button (no minimum length), then "Link" | the configured **Group ID Attribute** value (docs: "such as `entryUUID` or `objectGUID`") as the group's `RemoteId`; the name comes from the display-name attribute and is read-only |

- **A directory group that is gone:** Mattermost **deletes** the linked hub group ("Mattermost groups that are linked to AD/LDAP groups no longer included in your filter are deleted"). The spec keeps the link with `missing_since` and a "missing" tag, which is reversible and keeps grants. That is safer, and no reference contradicts it.
- **Bounding the search** (Mattermost and GitLab document no minimum; GitLab's limit was not readable):
  - search on a debounced input or on submit;
  - keep the spec's `sizeLimit: 20`. ldapts accepts `sizeLimitExceeded` when `sizeLimit` is set (`ldap-client.md` §3.5);
  - when exactly 20 come back, show "Showing the first 20 matches; refine the search";
  - a 2-character minimum is a reasonable UI choice, but no reference requires it.

### Quotes and pinned code

- Grafana: "Go to the External group sync tab, and click **Add group**. … Insert the value of the group you want to sync with. This becomes the Grafana `GroupID`. … For LDAP, this is the LDAP distinguished name (DN) of LDAP group you want to synchronize with the team." / "Group matching is case insensitive." (`GF:docs/sources/setup-grafana/configure-access/configure-team-sync.md:43-60`); manual members kept: "enables you to manually add a user as member of a team, and it will not be removed when the user signs in" (`:25`).
- GitLab: "In the **LDAP Group cn** field, begin typing the CN of the group. There is a dropdown list with matching CNs in the configured `group_base`. Select your CN from this list." (`GL:doc/user/group/access_and_permissions.md:303-313`); `CREATE TABLE ldap_group_links (… cn character varying, group_access integer NOT NULL, group_id bigint NOT NULL, … provider character varying, filter character varying, …)` (`GL:db/structure.sql:24105-24115`, from the `tmp/b3-research/src/ldap-gitlab` clone).
- Mattermost: `const LDAP_GROUPS_PAGE_SIZE = 200;` and the search runs on Enter (`handleGroupSearchKeyUp`) or the Search button, with `opts.q = q.trim()` (`MM:webapp/channels/src/components/admin_console/group_settings/groups_list/groups_list.tsx:22,284-319,415-430`); link by key: `this.props.actions.link(group.primary_key)` (`:127-128`); server `opts := model.LdapGroupSearchOpts{ Q: c.Params.Q, … }` → `GetAllLdapGroupsPage(…)` (`MM:server/channels/api4/ldap.go:163-173`), and `linkLdapGroup` requires `RemoteId`, then `GetLdapGroup(c.AppContext, c.Params.RemoteId)` and `GetGroupByRemoteID(ldapGroup.GetRemoteId(), model.GroupSourceLdap)` (`:207-237`); docs: specify "the `Group ID Attribute` and the `Group Display Name Attribute`" (`MMD:source/administration-guide/onboard/ad-ldap-groups-synchronization.rst:46-48`), "The link action will create Mattermost groups corresponding to the AD/LDAP group" (`:70`), "Mattermost groups that are linked to AD/LDAP groups no longer included in your filter are deleted." (`:62`), and the group name "is automatically mapped from the AD/LDAP group common name attribute and is read-only" (`:83`).

### Not confirmed

- GitLab's CN search size limit and minimum characters: EE code (`ee/`), not readable on 2026-10-10. Mattermost's server-side LDAP group search (EE) is closed, so whether it bounds the search beyond paging is unknown.

---

## B.8 Sign-in tabs: directory account and local account

### Verdict

**Directory tab first and active, its field labelled "Username", local tab second.** This matches the spec (§6.3) and both references.

- **GitLab:**
  - one tab per LDAP server, labelled with the server's `label` (default `'LDAP'`), then "Standard" when password sign-in is enabled;
  - the first LDAP tab is active when LDAP is the highest-priority form provider;
  - the LDAP form's field is labelled "Username";
  - GitLab **remembers the last tab** in a cookie, `current_signin_tab`, set on tab click and read on load (the class comment says localStorage; the code uses a cookie).
- **Open WebUI:**
  - LDAP mode is the default when enabled (`let mode = … enable_ldap ? 'ldap' : 'signin'`);
  - the field is labelled "Username";
  - a text button toggles "Continue with Email" / "Continue with LDAP";
  - it is **not remembered** (plain component state).
- **Remembering the tab is optional.** If the plan wants it, the hub's ADR-0016 cookie pattern (read on the server, so the first paint is right) fits better than GitLab's script-side cookie, which switches the tab after load. Otherwise leave it out, as Open WebUI does.

### Pinned code

- GitLab: `- if any_form_based_providers_enabled? = render 'devise/shared/tabs_ldap' … - elsif password_authentication_enabled_for_web? = render 'devise/sessions/new_base'` (`GL:app/views/devise/sessions/new.html.haml:13-17`); tabs `gl_tab_link_to server['label'], "##{server['provider_name']}", { item_active: i == 0 && form_based_auth_provider_has_active_class?(:ldapmain) … }` and `gl_tab_link_to _('Standard'), '#login-pane'` (`GL:app/views/devise/shared/_tabs_ldap.html.haml:7-13`); `form_based_auth_provider_has_active_class?(provider) form_based_provider_with_highest_priority == provider` (`GL:app/helpers/auth_helper.rb:97-99`); `label: 'LDAP'` (`GL:config/gitlab.yml.example:994`); `f.label :username, _('Username')` (`GL:app/views/devise/sessions/_new_ldap.html.haml:8`); `class SigninTabsMemoizer { constructor({ currentTabKey = 'current_signin_tab', … }` … `saveData(val) { setCookie(this.currentTabKey, val); }` (`GL:app/assets/javascripts/pages/sessions/new/signin_tabs_memoizer.js:4-62`); docs: "When LDAP web sign in is disabled, users don't see an **LDAP** tab on the sign-in page." (`GL:doc/administration/auth/ldap/_index.md:1162`).
- Open WebUI: `let mode = $config?.features.enable_ldap ? 'ldap' : 'signin';` (`OW:src/routes/auth/+page.svelte:34`); `{$i18n.t('Username')}` label (`:315-327`); the toggle `mode === 'ldap' ? $i18n.t('Continue with Email') : $i18n.t('Continue with LDAP')` (`:589-604`) (copy `tmp/b3-research/owui-auth-page.svelte.txt`).

---

## B.9 The scheduler claim and missed-run catch-up

### Verdict

**Both mechanisms are established practice. Change one thing: give the startup run its own slot, `startup:<last due ISO time>`.**

- **One row per (job, scheduled time), enforced by a unique key:**
  - Documenso: a deterministic primary key `cron_<sha256("cron:<job>:<ISO slot>")>`; the losing replica gets P2002 and skips;
  - GoodJob: a unique index on `(cron_key, cron_at)`;
  - Solid Queue: a unique index on `(task_key, run_at)` in `solid_queue_recurring_executions`;
  - Graphile Worker: a conditional upsert on `known_crontabs.last_execution`, which compares and sets per job and time.
- **Startup catch-up of missed runs:**
  - GoodJob's `cron_graceful_restart_period` re-enqueues every slot within `[max(start − period, last cron_at), start]`; it "should match the expected downtime during deploys";
  - Graphile Worker's `fill=<period>` backfills from `max(now − fill, last_execution)`, with "The higher you set the fill parameter, the longer the worker startup time will be";
  - Documenso catches up only **within a running process** ("Only take the latest slot — sweep-style jobs don't need to catch up every missed slot after downtime, just the most recent one"). Its `lastTickAt` starts at boot, so it does **not** catch up across restarts;
  - Homarr's `runOnStart` runs at every start, without checking for a missed slot.
- **The spec's rule** ("run once when the last succeeded run is older than the schedule's last due time") keeps Documenso's "latest slot only", which suits a reconciliation, and adds GoodJob's and Graphile's across-restart catch-up.
- **The refinement:** with a dedicated `startup:` slot, N containers starting together (a deploy) claim the startup run once, as GoodJob and Graphile dedupe their catch-up through the same unique key. The `schedule:` slot for that time stays free if it has not run. If that slot already ran and failed, the `startup:` slot is still unclaimed, so the retry is not blocked.
- **Computing "last due time" from the cron expression:**
  - Documenso steps forward from the last tick with cron-parser `next()` until `> now`;
  - Graphile steps minute by minute and matches each minute against the parsed expression;
  - GoodJob asks fugit for the times `within(range)`;
  - the croner equivalent is `previousRuns(1)`, documented in `periodic-jobs.md` and covered by the croner research. All three references bound the backward search to a window, so the croner call should too.

### Quotes and pinned code

- Documenso: "Build a deterministic BackgroundJob ID for a cron run so that multiple instances of the local provider racing to enqueue the same slot will collide on the primary key instead of creating duplicates." / `const key = \`cron:${jobId}:${scheduledFor.toISOString()}\`;` (`DOC:packages/lib/jobs/client/local.ts:19-29`); the poller runs every 30 s plus 0–5 s jitter (`:37-38`); `lastTickAt: new Date()` at registration (`:75`); "Only take the latest slot" and the P2002 skip (`:128-154`); `getDueCronSlots`uses`CronExpressionParser.parse(cronJob.cron, { currentDate: cronJob.lastTickAt })`and loops`next()`while`<= now` (`:171-191`).
- GoodJob: "Enabling cron on multiple processes will not enqueue duplicate jobs; GoodJob's cron uses unique indexes to ensure that only a single job is enqueued for a given time interval." (`GJ:README.md:794`); "`cron_graceful_restart_period` … when cron starts, attempt to re-enqueue jobs that would have been enqueued by cron within this time period (e.g. `1.minute`). This should match the expected downtime during deploys." (`:314`); `time_period = [thr_started_at - @graceful_restart_period, last_cron_at].compact.max..thr_started_at` then `thr_cron_entry.within(time_period).each do |cron_at| … enqueue(cron_at)` with the comment "The existing uniqueness logic should ensure this does not create duplicate jobs." (`GJ:lib/good_job/cron_manager.rb:117-138`); `add_index :good_jobs, [:cron_key, :cron_at], … unique: true` (`GJ:lib/generators/good_job/templates/install/migrations/create_good_jobs.rb.erb:101-102`).
- Graphile Worker: "guarantees (thanks to ACID-compliant transactions) that no duplicate task schedules will occur", "can backfill missed jobs if desired (e.g. if the Worker wasn't running when the job was due to be scheduled)" (`GW:website/docs/cron.md:17-26`); "`fill=t` … backfill any entries from the last time period `t`, for example if the worker was not running when they were due to be executed (by default, no backfilling)" (`:86-88`); "Using `fill` will not backfill new tasks, only tasks that were previously known." and the caution above (`:109-117`); "the first worker that attempts to queue a particular cron job will succeed and the other workers will take no action — this is thanks to SQL ACID-compliant transactions and our `known_crontabs` lock table" (`:150-156`); the claim `insert into … known_crontabs … on conflict (identifier) do update set last_execution = excluded.last_execution where (known_crontabs.last_execution is null or known_crontabs.last_execution < excluded.last_execution) returning …` (`GW:src/cron.ts:151-161`); the backfill walks minute by minute from `startTime - largestBackfill`, matching each minute (`:240-300`).
- Solid Queue: "an entry in a new `solid_queue_recurring_executions` table is created in the same transaction as the job is enqueued. This table has a unique index on `task_key` and `run_at`, ensuring only one entry per task per time will be created." (`SQ:README.md:926`).
- Homarr: `new Cron(cronExpression, { name, timezone: creatorOptions.timezone, paused: true }, …)` and `if (!options.runOnStart) return; … await catchingCallbackAsync();` (`HO:packages/cron-jobs-core/src/creator.ts:87-95,105-119`).

### Not confirmed

- Graphile Worker and GoodJob are not Next.js projects (Graphile is Node/PostgreSQL, GoodJob is Ruby). They are cited for the claim and catch-up pattern, which is engine-neutral; MySQL's unique index gives the same guarantee (`periodic-jobs.md` Q4).

---

## B.10 A directory account changing its password in the account menu

### Verdict

**Hide "Change password" in the account menu for `ldap` accounts, refuse on the server too, and carry the source in the session.**

- **Every reference refuses on the server** and shows the user something:

  | Project | UI | Server refusal |
  | --- | --- | --- |
  | GitLab | Hides the "Change password" button | The password route answers **404** |
  | Mattermost | Keeps the "Password" row, described "Login done through AD/LDAP"; opened, it reads "Login occurs through AD/LDAP. Password cannot be updated." with no form | **400**: "Update password failed because the user is logged in through an OAuth service." |
  | Grafana | Keeps the "Change password" nav link for everyone; the page shows "You cannot change password when signed in with LDAP or auth proxy." | **403**: "Cannot update external User" |

- **Where the UI reads the source:**
  - Mattermost: `auth_service` on the user object the web app loads;
  - Grafana: `authLabels` and `isExternal` from `/api/user`;
  - GitLab: decides on the server per request (`current_user.allow_password_authentication?`, derived from the user's LDAP identity).
- **For the hub:**
  - the account dropdown (`components/shell/account-dropdown.tsx`) reads `useSession()`, so add `source` to the token and session: the `jwt` callback already reads the row on every call (`lib/auth/options.ts:104-129`), and the `session` callback forwards it;
  - then follow GitLab and drop the "Change password" item for `ldap` (the simplest, and nothing is left to explain), or Mattermost and show it disabled with the reason;
  - in both cases `changeOwnPassword` (DAL) refuses `source = 'ldap'` with a fixed action code, since all three references refuse server-side;
  - spec §6.3 covers the users drawer but not the account menu; the plan should add this.

### Quotes and pinned code

- **GitLab:**
  - `before_action :authorize_change_password!, except: [:reset]` and `def authorize_change_password! render_404 unless @user.allow_password_authentication? end` (`GL:app/controllers/user_settings/passwords_controller.rb:12,87-89`);
  - `def allow_password_authentication_for_web? return false if ldap_user? && !Gitlab::Auth::Ldap::Config.prevent_ldap_sign_in? …` and `allow_password_authentication_for_git?` returns false for `password_based_omniauth_user?`, which is `ldap_user? || crowd_user?` (`GL:app/models/user.rb:1809-1825,1908-1910`); `ldap_user?` reads the identities (`:1920-1926`);
  - the button, on the "Password and authentication" page: `- if current_user.allow_password_authentication? … = s_('ProfilesAuthentication|Change password')` (`GL:app/views/profiles/two_factor_auths/show.html.haml:24-33`);
  - docs: "After a user links an LDAP identity to their GitLab account, they can no longer use the standard username and password authentication flow. Instead, users must authenticate with their LDAP credentials." (`GL:doc/administration/auth/ldap/_index.md:48-52`).
- **Mattermost:**
  - `[Constants.LDAP_SERVICE]: … defaultMessage: 'Login occurs through AD/LDAP. Password cannot be updated.'` (`MM:webapp/channels/src/components/user_settings/security/user_settings_security.tsx:374-414`) and the collapsed description `defaultMessage='Login done through AD/LDAP'` (`:472-478`);
  - the server: `if user.AuthData != nil && *user.AuthData != "" { return model.NewAppError("updatePassword", "api.user.update_password.oauth.app_error", nil, "auth_service="+user.AuthService, http.StatusBadRequest) }` (`MM:server/channels/app/user.go:1141-1153`), whose English text is "Update password failed because the user is logged in through an OAuth service." (`MM:server/i18n/en.json:6493-6495`);
  - the user model: `AuthService string \`json:"auth_service" …\`` (`MM:server/public/model/user.go:100-101`).
- **Grafana:**
  - `const authSource = user.authLabels?.length && user.authLabels[0]; if (authSource === 'LDAP' || authSource === 'Auth Proxy') { return <p>… You cannot change password when signed in with LDAP or auth proxy.</p> }` (`GF:public/app/features/profile/ChangePasswordForm.tsx:28-46`);
  - the nav link is added when `cfg.AddChangePasswordLink()`, which is `!cfg.DisableLoginForm && !cfg.DisableLogin`, a global setting and not a per-user one (`GF:pkg/services/navtree/navtreeimpl/navtree.go:291-296`; `GF:pkg/setting/setting.go:962-964`);
  - the server: `ChangeUserPassword` calls `hs.errOnExternalUser(…)` (`GF:pkg/api/user.go:569-588`), which answers `response.Error(http.StatusForbidden, "Cannot update external User", nil)` when the account's auth module is an enabled provider (`GF:pkg/api/utils.go:30-53`); the same guard covers password reset (`GF:pkg/api/password.go:95`).

---

## Where findings touch the spec

1. **§7.3 error mapping (gap):** strongerAuthRequired (8), confidentialityRequired (13) and any service-account bind failure should map to `DirectoryUnavailable` with fixed log codes. A signing-enforcing DC otherwise shows every user "Check your username and password" (A.1).
2. **§13 risk "LDAP signing policy" (sharper):** an in-place upgrade of the owner's DC to Windows Server 2025 without a signing policy turns signing on and breaks `none` (A.1).
3. **§14 "Docker on WSL2" (resolved):** the machine runs Docker Desktop, and WSL's networking mode does not affect container egress. Use the probe in A.2.
4. **ADR-0027 B3b note (made concrete):** "answers an unknown username in the same time as a wrong password" should be a response-time floor, not a dummy bind, which AD's PDC forwarding would make unequal anyway. The local provider keeps its dummy bcrypt for `ldap` rows (B.3).
5. **§6.4 claim (refinement):** apply the in-flight check to scheduled and startup claims as well (Keycloak's one key), and use `startup:<last due time>` as the startup slot (B.4, B.9).
6. **§6.3 and the account menu (gap):** hide or disable "Change password" for `ldap` accounts, carry `source` in the session, and refuse in `changeOwnPassword` (B.10).
7. **Agrees with the spec:** the `missing_since` link state over Mattermost's deletion (B.7); the Directory tab as default (B.8); two deactivation markers (GitLab) over Mattermost's directory-only activation (B.6); 90-day run retention (stricter than Mattermost's and n8n's keep-forever, B.4).

---

## Pinned sources

| Project or source | Pin | Paths read |
| --- | --- | --- |
| Authelia | `authelia/authelia@2ed18389ec3eebb2c054abdc1b617f38b3ed952b` | `internal/middlewares/timing_attack_delay.go`, `internal/server/handlers.go`, `internal/handlers/handler_firstfactor_password.go`, `internal/authentication/ldap_user_provider.go` |
| Spring Security | `spring-projects/spring-security@126f02bf0fbda597f5ef86fd6305b62e5282104a` | `ldap/…/authentication/BindAuthenticator.java`, `ldap/…/search/FilterBasedLdapUserSearch.java`, `core/…/dao/DaoAuthenticationProvider.java` |
| django-auth-ldap | `django-auth-ldap/django-auth-ldap@3efc4940cfdb9d9039d0f7916b903a23385141a0` | `django_auth_ldap/backend.py` |
| ldap-authentication | `shaozi/ldap-authentication@5fdb864b65222989ea3721817e4359df3a4c410c` | `index.js` (copy `tmp/b3-research/ldap-authentication-index.js.txt`) |
| OpenLDAP | `openldap/openldap@ae910be781fe723f88fdc28b6a1fc6f1f1ce07c4` | `servers/slapd/back-mdb/bind.c` |
| Keycloak | `keycloak/keycloak@c7de391ae4d8a83ad62b8386cab85d37fbb6324c` | `services/…/browser/AbstractUsernameFormAuthenticator.java`, `services/…/util/AuthenticatorUtils.java`, `server-spi/…/storage/user/SynchronizationResult.java`, `model/storage-private/…/storage/UserStorageSyncTask.java` |
| n8n | `n8n-io/n8n@5b78e8b655452adea7dd0a7199480f2cf773bd35` | `packages/@n8n/db/src/entities/{auth-provider-sync-history,types-db}.ts`, `packages/@n8n/db/src/migrations/common/1674509946020-CreateLdapEntities.ts`, `packages/@n8n/db/src/repositories/auth-provider-sync-history.repository.ts`, `packages/cli/src/modules/ldap.ee/{ldap.service.ee,helpers.ee,ldap.controller.ee,constants}.ts`, `packages/cli/src/commands/ldap/reset.ts`, `packages/frontend/editor-ui/src/features/settings/sso/views/SettingsLdapView.vue`, `packages/frontend/@n8n/i18n/src/locales/en.json`, `docs/generated/postgres-schema/public.auth_provider_sync_history.md` |
| Mattermost | `mattermost/mattermost@4d94455ab041c0eed6676064cd8b033e9912fc5b` | `webapp/channels/src/components/admin_console/{admin_definition_ldap_wizard.tsx,jobs/table.tsx,jobs/job_status.tsx,system_user_detail/system_user_detail.tsx,group_settings/groups_list/groups_list.tsx}`, `webapp/channels/src/components/user_settings/security/user_settings_security.tsx`, `server/channels/jobs/{jobs,schedulers,base_schedulers}.go`, `server/channels/store/sqlstore/job_store.go`, `server/channels/app/{job,user}.go`, `server/channels/api4/ldap.go`, `server/public/model/{config,user}.go`, `server/i18n/en.json` |
| Mattermost docs | `mattermost/docs@bd09d959514c34e72a33c24663b5946682b656ec` | `source/administration-guide/configure/{authentication,experimental}-configuration-settings.rst`, `source/administration-guide/onboard/{ad-ldap,ad-ldap-groups-synchronization}.rst` |
| GitLab (CE mirror) | `gitlabhq/gitlabhq@0739b8bfefeec6f2a70684c5e3dbe47c82c0acbd` | `app/views/devise/sessions/{new.html.haml,_new_ldap.html.haml}`, `app/views/devise/shared/_tabs_ldap.html.haml`, `app/assets/javascripts/pages/sessions/new/signin_tabs_memoizer.js`, `app/helpers/{auth_helper,users_helper}.rb`, `app/controllers/user_settings/passwords_controller.rb`, `app/models/{user,user_synced_attributes_metadata}.rb`, `app/views/profiles/two_factor_auths/show.html.haml`, `app/views/user_settings/profiles/show.html.haml`, `app/views/admin/users/_password_fields.html.haml`, `lib/sidebars/user_settings/menus/access_menu.rb`, `config/gitlab.yml.example`, `db/structure.sql`, `doc/administration/auth/ldap/{_index,ldap_synchronization,ldap-troubleshooting}.md`, `doc/user/group/access_and_permissions.md` |
| Grafana | `grafana/grafana@7b702d7969564cb677ae3e3f393dedd6f867264e` | `public/app/features/admin/{UserProfile.tsx,UserAdminPage.tsx,UserLdapSyncInfo.tsx,Users/UsersTable.tsx,ldap/LdapSyncInfo.tsx}`, `public/app/features/profile/{ChangePasswordForm,ChangePasswordPage}.tsx`, `pkg/api/{user,utils,password}.go`, `pkg/services/navtree/navtreeimpl/navtree.go`, `pkg/setting/setting.go`, `docs/sources/setup-grafana/configure-access/configure-team-sync.md` |
| Backstage | `backstage/backstage@75128025b788bb70e46553141a9a66f80777116c` | `plugins/catalog-backend-module-ldap/src/processors/LdapOrgEntityProvider.ts`, `…/src/ldap/{read,relations}.ts` |
| Open WebUI | `open-webui/open-webui@8bd8b4fac5e059578ac0c74b3c18d11139f88b7d` | `src/routes/auth/+page.svelte` (copy `tmp/b3-research/owui-auth-page.svelte.txt`) |
| Documenso | `documenso/documenso@38ecb217effcc53a7164d7123c51336f636bd3b2` | `packages/lib/jobs/client/local.ts` |
| Graphile Worker | `graphile/worker@4cda192c5df254392a1dff350e5d73f7d2c18a85` | `website/docs/cron.md`, `src/cron.ts` |
| GoodJob | `bensheldon/good_job@30718bb4260b07fae26d12fa9a3108330325ba32` | `README.md`, `lib/good_job/cron_manager.rb`, `lib/generators/good_job/templates/install/migrations/create_good_jobs.rb.erb` |
| Solid Queue | `rails/solid_queue@73602fe39b95d48d99f0f419293c566310dae3e2` | `README.md` |
| Homarr | `homarr-labs/homarr@ad15cfc3bf391f7152035d263926265c28f6631c` | `packages/cron-jobs-core/src/creator.ts` |
| Docker docs | `docker/docs@18bbfeeb249da011f359d558dba84c4b6dc3a335` | `content/manuals/desktop/features/networking/_index.md`, `content/manuals/desktop/features/wsl/_index.md`, `content/manuals/engine/network/_index.md`, `content/reference/compose-file/services.md` |
| Docker Compose | `docker/compose@e11dce59fca0ec83e76f9dae291c2f1b16b02765` | `docs/reference/compose_run.md` |
| OWASP | `OWASP/CheatSheetSeries@29994dd8a2e6f50fa3d5607b046b54d7c6945afd` | `cheatsheets/Authentication_Cheat_Sheet.md` (copy `tmp/b3-research/owasp-authn.md`) |
| Microsoft Learn / Support | read 2026-10-10 | `windows-server/identity/ad-ds/ldap-signing` (2026-10-02), `…/ldap-channel-binding` (2026-10-02), `troubleshoot/…/ldap-session-security-settings-requirements-adv190023` (2026-02-12), `troubleshoot/…/enable-ldap-signing-in-windows-server` (2026-02-12), `troubleshoot/…/enable-ldap-over-ssl-3rd-certification-authority` (2026-02-12), `troubleshoot/windows-server/identity/password-change-processing-conflict-resolution-function`, `windows-server/get-started/whats-new-windows-server-2025` (2026-01-15), `previous-versions/windows/desktop/ldap/return-values` (2018-05-31), KB4520412 (2025-01-03), MS-ADTS 5.1.1.1.1, `windows/wsl/networking` (2025-08-06) |
| Node.js 22 | read 2026-10-10 | https://nodejs.org/docs/latest-v22.x/api/timers.html; `tls.checkServerIdentity` (copy `tmp/b3-research/node22-tls.md`) |

Working copies (`.txt` and `.md` only) are in `tmp/b3b-ad-refs/`.
