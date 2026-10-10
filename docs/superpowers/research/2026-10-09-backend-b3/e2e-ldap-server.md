# E2E LDAP server(s) for B3b: image choice and AD fidelity

Date: 2026-10-09. Scope: which throwaway LDAP server image(s) `docker-compose.e2e.yml` should run so that the Playwright suite (ADR-0010) can exercise B3b's LDAP sign-in and periodic directory sync (ldapts client), how much Active Directory behaviour each candidate reproduces, and what stays for the owner's live AD check. Nothing was pulled or run: every claim below comes from registry metadata (Docker Hub / Quay APIs), image source, product source, or documentation, pinned at the end. Excerpts are saved in `tmp/b3-research/e2e-ldap/` (`.txt`, `.md`).

Short SHAs: `SMB`=smblds/smblds-container@84fe79e6, `SIK`=samba-in-kubernetes/samba-container@60777e4a, `SCC`=samba-in-kubernetes/sambacc@7e2e1b69, `SAM`=samba-team/samba@f28e9e6d (GitHub mirror of gitlab.com/samba-team/samba), `OSX`=osixia/container-openldap@6e26809a (branch `develop`, the v2 line), `OL`=openldap/openldap@ae910be7 (master), `OL26`=openldap/openldap@f46b74e7 (OPENLDAP_REL_ENG_2_6), `389`=389ds/389-ds-base@6ab091c6, `LL`=lldap/lldap@99c510a7, `GA`=glauth/glauth@251ec3ef, `LT`=ldapts/ldapts@e6704177, `AK`=goauthentik/authentik@c3f92b69, `O2`=magenta-aps/os2mo-ldap-import-export@eea33ecf, `MM`=mattermost/mattermost@4d94455a, `GF`=grafana/grafana@7b702d79, `GQ`=gitlab-org/gitlab-qa@d18bf530 (gitlab.com), `NC`=nextcloud/server@859e88ab, `NCD`=nextcloud/docker-ci@9e96f78a, `KC`=keycloak/keycloak@c7de391a, `GT`=go-gitea/gitea@c0a8eb8e, `N8`=n8n-io/n8n@6fc0aeda, `VG`=vegardit/docker-openldap@8331dc43, `BN`=bitnami/containers@9943e77f, `DD`=docker/docs@85825160.

---

## 0. Answer in one paragraph

Run **two small servers behind a Compose profile**: **`smblds/smblds`** (Samba AD DC trimmed to the LDAP service, built for developer and CI use, needs no privileged mode) as the AD-like server, and **`osixia/openldap:2.6.15-alpha`** (OpenLDAP 2.6.15 on Alpine, 15 MB, LDIF bootstrap, memberOf/ppolicy/TLS switches) as the generic LDAPv3 server, both pinned by digest. Samba reproduces every AD behaviour B3b's defaults rely on: binary `objectGUID`, `sAMAccountName`/`userPrincipalName`, `userAccountControl` with the bit-AND rule `1.2.840.113556.1.4.803`, the in-chain rule `1.2.840.113556.1.4.1941`, the AD-style `memberOf` backlink, paged results, LDAPS/StartTLS, and refusing simple binds without TLS by default. Samba does **not** enforce AD's 1000-entry `MaxPageSize`, so it cannot catch a sync that forgets to page. OpenLDAP can do that through per-identity `olcLimits`, and it also covers the generic path: text `entryUUID`, `uid`, `groupOfNames` + memberOf, nested groups through `slapo-nestgroup`, and a ppolicy lock as the disabled marker. The owner's live AD check keeps the list in §6 (paging limits under real data, referrals, channel binding, AD error sub-codes, scale of the in-chain query). The two-server pattern has a direct precedent: os2mo-ldap-import-export runs `smblds/smblds` and `osixia/openldap` side by side in CI (`O2:docker-compose.yml:7,25-49`, `O2:.gitlab-ci.yml:85-119`). authentik runs a Samba DC plus `osixia/openldap:2.6.10-alpha` pinned by digest (`AK:tests/e2e/compose.yml:57-62`).

---

## 1. What the hub needs from the test server

| # | Need (from the B3b brief) | AD | Generic LDAPv3 |
| --- | --- | --- | --- |
| H1 | Service account simple bind, subtree search with a configurable user filter | yes | yes |
| H2 | AD default user filter `(!(userAccountControl:1.2.840.113556.1.4.803:=2))` works as written | yes | n/a |
| H3 | A disabled-account marker usable in a filter (and the bind refused) | `userAccountControl` bit 2 | server-specific |
| H4 | Binary `objectGUID` (16 bytes) as the id attribute | yes | — |
| H5 | Text `entryUUID` (RFC 4530) as the id attribute | — | yes |
| H6 | Login attribute `sAMAccountName` / `uid` | sAMAccountName | uid |
| H7 | `mail` and a display name | yes | yes |
| H8 | `memberOf` (direct) | yes | overlay |
| H9 | Nested groups through `(member:1.2.840.113556.1.4.1941:={dn})` | yes | — |
| H10 | Nested groups by another documented means | — | overlay |
| H11 | Paged search (RFC 2696 control honoured) | yes | yes |
| H12 | A size limit that forces the client to page (AD `MaxPageSize` = 1000) | yes | configurable |
| H13 | LDAPS with a self-signed / test CA | yes | yes |
| H14 | StartTLS on 389 | yes | yes |
| H15 | Bind as the user to check the password; wrong password gives `invalidCredentials` (49) | yes | yes |
| H16 | Runs without `privileged` / `CAP_SYS_ADMIN` (dev box, WSL, ~5 GB RAM) | — | — |
| H17 | Declarative seed at start (users, groups, nesting, a disabled user, passwords) | — | — |

Two RFC facts shape the tests:

- An AD-only filter on a non-AD server **silently matches nothing**. That is not an error. "Servers MUST NOT return errors if attribute descriptions or matching rule ids are not recognized" (`rfc4511.txt:1307-1309`). An unrecognized matching rule makes the item "Undefined" (`rfc4511.txt:1415-1422`), and Undefined entries are skipped (`rfc4511.txt:1268-1272`). OpenLDAP knows `1.2.840.113556.1.4.803` (`integerBitAndMatch`, `OL:servers/slapd/schema_init.c:6851`) but has no `userAccountControl`, so the AD default user filter returns zero users there. It does not know `1.2.840.113556.1.4.1941` at all, so the AD default group filter returns zero groups. A generic-server e2e case should assert that a wrong filter shows up as "0 users found" in the hub, not as a crash.
- `entryUUID` is `USAGE directoryOperation` (`rfc4530.txt:193-200`), and operational attributes "are not returned in search requests unless requested by name" (`rfc4512.txt:2026`). The hub must list the id attribute explicitly. This holds for `objectGUID` too, which ldapts must also be told to return as a Buffer (`explicitBufferAttributes`, see `ldap-client.md` §3).

---

## 2. Candidates at a glance

Registry data was read on 2026-10-09 (Docker Hub v2 API, Quay API). Sizes are compressed amd64 sizes. No candidate documents a memory figure (see §7).

| Image | Publisher | Latest tag (date) | Maintenance signal | Licence | Size | Privileges | Seed mechanism |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `smblds/smblds:latest` | Robert Scheck (smblds project), Docker Hub + `quay.io/smblds/smblds` | `latest` only, rebuilt daily (2026-10-08) | GitHub repo pushed 2026-10-01; daily cron build (`SMB:.github/workflows/image.yml:4-5`); 117k pulls, 28 stars | GPL-3.0-or-later | 54 MB | none | `/entrypoint.d/*` scripts (e.g. `samba-tool user create`) |
| `quay.io/samba.org/samba-ad-server` | samba-in-kubernetes (Samba developers; authors line names Red Hat) | `v0.9` (2026-06-18); `latest`/`nightly` 2026-10-08 | active; Quay description "Samba AD DC container. Currently only for testing." | GPL-3.0 | 190 MB | `--privileged` (README) / `SYS_ADMIN` (k8s example) | sambacc JSON: users, groups, OUs, `member_of` |
| `diegogslomp/samba-ad-dc` | individual | `4.25.0` (2026-09-28) | repo pushed 2026-06-13, 68 stars | GPL-3.0 | 317 MB | `--privileged` | `docker exec … samba-tool` |
| `nowsci/samba-domain` | individual (Fmstrat) | monthly rebuild (2026-10-01) | source repo last push 2024-08-18 | GPL-3.0 | 181 MB | `--privileged`, host IP aliases | env + exec |
| `instantlinux/samba-dc` | individual | `4.23.10-r0` (2026-10-07) | active | Apache-2.0 (repo) | 66 MB | `network_mode: host` + `CAP_SYS_ADMIN` | env + exec |
| `ghcr.io/beryju/test-samba-dc:v1.0` | authentik's maintainer | v1.0 | repo pushed 2026-09-18, 1 star | — | — | `cap_add: SYS_ADMIN` | env (domain, admin password) |
| `osixia/openldap:2.6.15-alpha` | osixia | `2.6.15-alpha` (2026-10-07), `2.6.10-alpha` (2026-04-27) | **alpha** v2 rewrite ("complete rewrite … not backward compatible", `OSX:CHANGELOG.md`); 4.2k stars | MIT | 15 MB | none (runs as uid 911) | LDIF dirs `ldif/data/custom`, `ldif/config/custom`, env switches |
| `osixia/openldap:1.5.0` | osixia | 2021-02-19 (`latest`/`stable` still point here) | frozen; Hub banner: "The stable tag will be removed in the coming weeks, please use the 1.5.0 tag" | MIT | 87 MB | none, but see Mattermost note in §4 | `bootstrap/ldif/custom` |
| `bitnami/openldap` | Bitnami/Broadcom | **no tags** on Docker Hub | "This image is no longer available for free through Docker Hub" (Hub description); `bitnamilegacy/openldap` frozen at `2.6.10-debian-12-r4` (2025-08-19), "no longer updated" | Apache-2.0 (source) | 54 MB (legacy) | none | env + LDIF |
| `vegardit/openldap` | vegardit | `2.6.10` / `2.6.x` / `latest` (2026-10-07) | "Automatically rebuilt weekly" (`VG:README.md:31`) | Apache-2.0 | 44 MB | none | `/opt/ldifs/custom`, `custom-schema` |
| `ghcr.io/rroemhild/docker-test-openldap` | individual | v2.5.0 (2025-09-02); Hub copy archived | fixed Futurama dataset, Debian bookworm | MIT | — | none | pre-seeded (fixed) |
| `389ds/dirsrv` | 389 Directory Server project (built on openSUSE OBS) | `3.1` (2025-06-24) while upstream is at 3.3.1 (2026-09-07) | container stream lags 15 months; amd64 only | GPL-3.0-or-later | 108 MB | none | none at start; `dsconf`/`dsidm`/ldapadd after start |
| `lldap/lldap` | lldap project | dated tags (2026-09-22); release v0.6.3 (2026-04-30) | active, 6.5k stars | GPL-3.0 | 26 MB | none | `bootstrap.sh` (GraphQL, JSON) after start |
| `glauth/glauth` | glauth project | v2.5.4 (2026-09-13) | active, 2.9k stars | MIT | 24 MB | none | TOML config file |
| `cleanstart/openldap` | CleanStart (vendor "hardened images") | `2.7.1-dev` (2026-10-08) | vendor catalogue, no CI precedent found | vendor terms not checked | 106 MB | — | not checked |

There is **no official OpenLDAP image**. `library/openldap` does not exist, `openldap/openldap` on Docker Hub is an empty placeholder (0 pulls, last update 2021-12-25), and the OpenLDAP Project ships source, not images. There is **no official Samba image** either. The Samba wiki's AD DC set-up page has no container instructions; it covers a host install with `samba-tool domain provision` (`samba-wiki-Setting_up_Samba_as_an_Active_Directory_Domain_Controller.wiki.txt:101-160`). Samba's own team publishes nothing on Docker Hub. The closest thing is samba-in-kubernetes under `quay.io/samba.org`.

---

## 3. Per candidate: coverage tables

Legend: **Y** = yes (source or doc cited); **P** = partly, or needs configuration; **N** = no; **?** = not confirmed.

### 3.1 `smblds/smblds` (Samba AD "Lightweight Directory Services") — recommended AD-like server

What it is: "This container image is primarily intended for developers and CI/CD use cases. As such, the Samba AD DC configuration has been reduced to a bare minimum of run-time components to enable applications to access an LDAP service that feels and behaves like the one of a Samba AD DC" (`hub-smblds_smblds.md:7`). It is built `FROM alpine:latest` with `apk add samba-dc … openldap-clients ldb-tools` (`SMB:Dockerfile:18,41`). Alpine 3.24 currently ships Samba 4.23.x (pkgs.alpinelinux.org, samba-dc v3.24 = 4.23.8-r0 on 2026-10-09; `instantlinux/samba-dc` is at 4.23.10 on the same base). It **patches out `smbd.set_nt_acl`** in `samba/ntacls.py` (`SMB:Dockerfile:43-48`). That patch is why it runs without privileges, whereas the other Samba images need privileges for the NT ACL xattrs. os2mo explains this in its compose file: "Most Samba AD DC OCI images require privileged … The ACL in particular … requires `CAP_SYS_ADMIN` … The below Samba AD DC OCI image is specifically designed to avoid all of this" (`O2:docker-compose.yml:26-36`). The entrypoint provisions a domain non-interactively, then sets `server services = ldap cldap`, disables NetBIOS and printing, and drops the DNS forwarder (`SMB:entrypoint.sh:21-54`). `INSECURE_LDAP=true` adds `ldap server require strong auth = no` (`:56-62`). `INSECURE_PASSWORDSETTINGS=true` turns off complexity and minimum length (`:64-73`). Every executable `/entrypoint.d/*` runs before `samba` starts (`:115-136`).

| Need |  | Evidence |
| --- | --- | --- |
| H1 bind + search | Y | standard Samba AD LDAP (`server services = ldap cldap`, `SMB:entrypoint.sh:26,44`) |
| H2 AD default user filter as written | **Y** | Samba registers `LDB_OID_COMPARATOR_AND` = `1.2.840.113556.1.4.803` (`SAM:lib/ldb/include/ldb.h:162`, `SAM:lib/ldb/common/ldb_match.c:739-757`); `userAccountControl` is maintained by `samldb` (`SAM:source4/dsdb/samdb/ldb_modules/samldb.c:2063` sets `UF_ACCOUNTDISABLE`) |
| H3 disabled marker | **Y** | `samba-tool user disable <name>` ("Disable a user account", `samba-tool.8.txt:1093`); bind refusal for a disabled account: expected AD behaviour, exact result code and diagnostic ? |
| H4 binary `objectGUID` | **Y** | `objectguid.c`: "add a unique objectGUID onto every new record" (`SAM:source4/dsdb/samdb/ldb_modules/objectguid.c:27`) |
| H5 text `entryUUID` | N | AD has none either; this is correct for an AD stand-in |
| H6 login attribute | **Y** | `samba-tool user add` writes `sAMAccountName` and `userPrincipalName = user@dnsdomain` (`SAM:python/samba/samdb.py:680-686`) |
| H7 mail, display name | **Y** | `--mail-address` (`SAM:python/samba/netcmd/user/add.py:104`); `displayName` from `--given-name` and `--surname`, and the CN becomes that display name, as in AD (`SAM:python/samba/samdb.py:665-701`) |
| H8 `memberOf` | **Y** | linked-attribute backlink (`SAM:source4/dsdb/samdb/ldb_modules/linked_attributes.c`), direct memberships only, as in AD |
| H9 in-chain `1.2.840.113556.1.4.1941` | **Y** | `#define SAMBA_LDAP_MATCH_RULE_TRANSITIVE_EVAL "1.2.840.113556.1.4.1941"` (`SAM:lib/ldb-samba/ldb_matching_rules.h:26`). The comment cites MS-ADTS 3.1.1.3.4.4.3 and the example `member:1.2.840.113556.1.4.1941:=cn=user,cn=users,…` (`SAM:lib/ldb-samba/ldb_matching_rules.c:260-268`). Registered at `:605-615` |
| H10 other nesting | n/a | groups nest with `samba-tool group addmembers <parent> <child>`, whose `--object-types` default is `user,group,computer` (`SAM:python/samba/netcmd/group.py:437-444`) |
| H11 paged search | **Y** | `LDB_CONTROL_PAGED_RESULTS_OID` `1.2.840.113556.1.4.319` (`SAM:lib/ldb/include/ldb.h:576`), module registered (`SAM:source4/dsdb/samdb/ldb_modules/paged_results.c:868`) |
| H12 forced paging (MaxPageSize 1000) | **N** | the Samba LDAP server caps a reply at `LDAP_SERVER_MAX_REPLY_SIZE` = 256 MiB (`SAM:source4/ldap_server/ldap_server.h:110`; `ldap_backend.c:685-697`). It reads `MaxQueryDuration` (`ldap_backend.c:1008`), but no 1000-entry `MaxPageSize` was found (search not exhaustive). An unpaged sync that would fail on AD passes on Samba |
| H13 LDAPS | **Y** | port 636 "mandatory SSL/TLS encryption" (`hub-smblds_smblds.md`, Exposed Ports). "On its first startup, Samba creates a private key, a self signed certificate and a CA certificate … valid for 700 days" (`samba-wiki-…LDAPS….wiki.txt:47-55`; `SAM:source4/lib/tls/tlscert.c:32`). The autogenerated cert carries only the DC host name as DNS SAN (`tlscert.c:70,118`), so clients that connect to `127.0.0.1` need `servername`, or the test mounts its own cert and sets `tls keyfile/certfile/cafile` (smb.conf(5); wiki "Using a custom self-signed certificate", `:69-76`) |
| H14 StartTLS | **Y** | "389 – TCP port for LDAP access (STARTTLS or plaintext if `INSECURE_LDAP` is enabled)" (Hub description) |
| H15 user bind, 49 on bad password | Y | standard; exact diagnostic text ? |
| H16 no privileges | **Y** | the ntacls patch above; run unprivileged as a GitLab CI service by os2mo (`O2:.gitlab-ci.yml:87-107`) |
| H17 declarative seed | P | no LDIF loader. Documented hook: "`/entrypoint.d` might be handy for customization scripts that contain e.g. `samba-tool user create`" (Hub description, Volumes). `ldbadd`/`ldapadd` wrappers are in the image (`SMB:Dockerfile:49-58`) |

AD-fidelity extras worth knowing:

- **Strong-auth default, like a hardened AD.** `ldap server require strong auth = yes` is the default. "A value of yes allows only simple binds and sasl binds with correct tls channel bindings over TLS encrypted connections … This matches LdapEnforceChannelBinding=2" (`smb.conf.5.txt:4644-4675`, Samba 4.25.0 man page). So a plain `ldap://` simple bind is refused unless `INSECURE_LDAP=true`. The Samba wiki says not to weaken this ("Do not set these options", `…LDAPS….wiki.txt:40-42`). Microsoft documents the same rejection when AD requires signing ("reject LDAP simple binds that are performed on a clear text (non-SSL/TLS-encrypted) connection", `tmp/b3-research/ms/enable-ldap-signing.md:149-153`).
- **DNs look like AD's**: `CN=<Given Surname>,CN=Users,DC=…` with spaces (`samdb.py:665-676`). That exercises DN escaping in the `{dn}` placeholder. `samba-tool` builds the DN with `"CN=%s,%s" % (cn, …)` and does not escape it (`samdb.py:671-676`). A test user with a comma in the name must therefore be added by LDIF (`ldbadd`/`ldapadd` in the image), not by `samba-tool`.
- **Host name:** set `hostname: dc` in Compose. os2mo had to inject `--host-name=dc` into provisioning on GitLab CI: "Without a stable hostname, Samba provisions with a random container ID which can cause DirSync and other AD operations to hang" (`O2:.gitlab-ci.yml:89-100`). The Samba wiki asks for a host name under 15 characters and a realm whose TLD is not `.local` (`samba-wiki-Setting_up….wiki.txt:45,49`).
- **Password complexity** is on unless `INSECURE_PASSWORDSETTINGS=true`. Seed passwords must be complex, or the switch must be set.
- **Maintenance shape:** one maintainer, `latest` tag only, rebuilt every day from `alpine:latest` (`SMB:.github/workflows/image.yml:3-9,58-60`). Pin it by digest (`sha256:563ba62d5d7e1914671f30d716435e7dd2d074eb500c4937dbb96ea04f269fd7` on 2026-10-08) and bump on purpose. A rebuild can also move the Samba minor version, through Alpine.
- **Healthcheck:** the built-in `HEALTHCHECK` only checks that the `samba` process exists (`SMB:healthcheck.sh:21`). The `up --wait` in `e2e/global-setup.ts:11` needs an LDAP-level check. The image's `ldapsearch` wrapper already reads `/root/.ldaprc` (`URI ldaps://localhost`, `TLS_REQCERT never`, admin bind DN) and `/root/.ldappass` (`SMB:entrypoint.sh:75-91`, `Dockerfile:49-52`).
- **Volumes:** the image declares `VOLUME` for `/etc/samba`, `/var/lib/samba` and others (`SMB:Dockerfile:63`). `docker compose down` leaves those anonymous volumes behind ("Anonymous volumes are not removed by default", `DD:_vendor/github.com/docker/compose/v5/docs/reference/compose_down.md:14`). Use `down -v`, or `tmpfs` mounts (tmpfs viability for Samba's tdb/ldb is ?).

### 3.2 `quay.io/samba.org/samba-ad-server` (samba-in-kubernetes)

This is the full Samba AD DC that `samba-dc-container` (sambacc) provisions and populates: `CMD ["run", "--setup=provision", "--setup=populate"]` (`SIK:images/ad-server/Containerfile.fedora:34-38`). The default domain is `DOMAIN1.SINK.TEST`. The README says it "must currently be run with privileges", for example `podman run --rm --privileged …` (`SIK:README.md:67-77`), and the Kubernetes example adds `SYS_ADMIN` (`SIK:examples/kubernetes/samba-ad-server-deployment.yml:20-22`). Seeding is JSON: `domain_groups` (name, optional OU) and `domain_users` (name, surname, given_name, password, `member_of`) (`SCC:docs/configuration.md:300-325`; example `SCC:examples/addc_ou.json`). Populate runs `samba-tool` before the daemon starts and writes a `/var/lib/samba/POPULATED` marker (`SCC:sambacc/commands/addc.py:43,160-186,193-206`). The JSON has **no `mail`, no disabled flag and no group-in-group**, so those need extra `docker exec … samba-tool` calls after start. Its Samba coverage is the same as 3.1 (H2–H15 Y, H12 N). H16 is **N** and H17 is **P**. os2mo, which uses smblds, notes it would move to this image "assuming the project eventually looses the need to use privileged" (`O2:docker-compose.yml:38-40`).

### 3.3 Other Samba DC images

`diegogslomp/samba-ad-dc` (`--privileged`, 317 MB, built from source), `nowsci/samba-domain` (`--privileged`, host IP aliases, aimed at production DCs; source repo idle since 2024-08), `instantlinux/samba-dc` ("must be run in network_mode:host, and with cap_add:CAP_SYS_ADMIN", Hub description line 12) and `ghcr.io/beryju/test-samba-dc` (Ubuntu 26.04 packages; authentik starts it with `cap_add=["SYS_ADMIN"]`, `AK:tests/e2e/test_source_ldap_samba.py:25-36`). Each gives the same Samba LDAP behaviour as 3.1, plus Kerberos, DNS and SMB that the hub does not need. Each needs privileges or host networking. None is a better fit than smblds on a shared WSL dev box.

### 3.4 `osixia/openldap:2.6.15-alpha` (v2) — recommended generic server

This is OpenLDAP `2.6.15-r0` from Alpine packages (`openldap-backend-all`, `openldap-overlay-all`, argon2/pbkdf2/sha2 password modules), running as user `ldap` (uid 911), listening on 3890/6360 (`OSX:Dockerfile:1-37`). Bootstrap happens only on empty config/data. Seed LDIF goes in `…/openldap-bootstrap/assets/ldif/data/custom`, and config LDIF in `…/ldif/config/custom` (both may be `${VAR}` templates). Feature switches are environment variables (`hub-osixia_openldap.md`, Environment Variables; `OSX:services/openldap-bootstrap/assets/ldif/README.md`).

| Need |  | Evidence |
| --- | --- | --- |
| H1 | Y | — |
| H2 AD filter as written | N (silently 0 users) | §1 RFC note; `integerBitAndMatch` exists (`OL:servers/slapd/schema_init.c:6851-6858`) but `userAccountControl` does not |
| H3 disabled marker | P | ppolicy: "If pwdAccountLockedTime is set to 000001010000Z, the user's account has been permanently locked … only takes effect when the pwdLockout password policy attribute is set to TRUE" (`tmp/b3-research/openldap/slapo-ppolicy.txt:681-690`). Filter `(!(pwdAccountLockedTime=*))`. Switch `OPENLDAP_BOOTSTRAP_PPOLICY=true`; default policy `pwdLockout` true |
| H4 | N | — |
| H5 text `entryUUID` | **Y** | every OpenLDAP entry (RFC 4530); request it by name |
| H6 | Y (`uid`) | `inetorgperson.ldif` in the default schemas |
| H7 | Y | `mail`, `displayName`, `cn` (inetOrgPerson) |
| H8 `memberOf` | **Y** | `OPENLDAP_BOOTSTRAP_MEMBEROF=true` → `olcOverlay=memberof` on `groupOfNames`/`member` (`OSX:services/openldap-bootstrap/assets/ldif/config/memberof/160-overlay-memberof-database.ldif.template`) |
| H9 in-chain rule | N | no `1.2.840.113556.1.4.1941` in OpenLDAP; the filter is Undefined, so 0 groups |
| H10 other nesting | **P** | `slapo-nestgroup` was "Added … (ITS#10161)" in OpenLDAP 2.6.8, 2024/05/21 (`OL26:CHANGES:217,224`). It offers "inclusion of parent groups when searching with (member=) filters … and expansion of parent groups when returning memberOf attributes" (`OL:doc/man/man5/slapo-nestgroup.5`). Config attributes are `olcNestGroupMember/MemberOf/Base/Flags`, with flags `member-filter`, `memberof-values` and others (`OL:servers/slapd/overlays/nestgroup.c:51-54,214-245`). `nestgroup.so` ships in Alpine 3.24's `openldap` package (pkgs.alpinelinux.org contents search). It is not one of osixia's switches: add `nestgroup.so` to `OPENLDAP_BOOTSTRAP_MODULES` and an overlay entry in `config/custom` (untested). Alternative: `slapo-dynlist` with `*`, but "currently nesting is only supported for Search operations, not Compares" (`openldap/slapo-dynlist.txt:178-183`) |
| H11 paged | Y | slapd core |
| H12 forced paging | **Y (config)** | "The size.prtotal limit controls the total number of entries that can be returned by a paged search", e.g. `limits users size.soft=5 size.hard=100 size.prtotal=disabled` (`openldap/admin26-guide.txt:4558-4562,4676-4681`). A small `size.soft/size.hard` with `size.prtotal=unlimited` on the service account reproduces "unpaged fails, paged succeeds". Global default here: `OPENLDAP_BOOTSTRAP_GLOBAL_SIZE_LIMIT=500` |
| H13 LDAPS | Y | `OPENLDAP_BOOTSTRAP_TLS=true`, mounted `cert.crt/cert.key/ca.crt` (Hub description, TLS) |
| H14 StartTLS | Y | 3890; `OPENLDAP_BOOTSTRAP_TLS_REQUIRED` optional |
| H15 | Y | — |
| H16 | Y | non-root |
| H17 | **Y** | LDIF dirs; authentik mounts `10-users.ldif` into `…/ldif/data/custom/` and certs into `…/openldap/assets/certs` (`AK:tests/e2e/test_source_ldap_sasl_external.py:138-185`) |

Notes:

- It is an **alpha**. The Hub banner says "v2 is a breaking release", and `latest` and `stable` still point to 1.5.0 from 2021. Pin by digest (`sha256:de37b295c8f11f6654a2376f7b5f9d5e9d028bd2f50713751f99ed270f7abbec` on 2026-10-07). If the owner rejects an alpha, use `vegardit/openldap:2.6.x` (§3.7) with the same LDIF content.
- When the hashed password variables are empty, the image generates passwords and prints them in the logs ("On first start, passwords are generated if hashed values are empty and printed in logs", Hub description, Quickstart notes). Tests need fixed values: set `OPENLDAP_BOOTSTRAP_DATA_ROOT_PASSWORD_HASHED`, or bind as a seeded service account.
- The Dockerfile declares no `VOLUME` (`OSX:Dockerfile:1-37`), so `down` resets it.

### 3.5 `osixia/openldap:1.5.0` (the most used one in CI today)

This is OpenLDAP 2.4.57 on osixia/light-baseimage 1.3.2 (Debian) (`osixia/container-openldap@v1.5.0:CHANGELOG.md`, `image/Dockerfile:3`). The 2.4 line is end-of-life upstream. The memberOf overlay is on by default (`bootstrap/ldif/03-memberOf.ldif`). Seeding uses `/container/service/slapd/assets/config/bootstrap/ldif/custom` (`osixia-v1.5.0-README.md:153-181`), and TLS works with mounted certs or an autogenerated one. Coverage: H5 Y, H8 Y, H11 Y, H13/H14 Y, H17 Y. H10 is **N**: `nestgroup` arrived in 2.6.8, and 2.4's dynlist has no nesting. H3 is P (ppolicy is available). H2/H4/H9 are N. Risks:

- Mattermost needs a host `sysctl` on Ubuntu 24.04: "The osixia/openldap:1.4.0 init scripts rely on unprivileged user namespaces; blocking them causes an immediate exit(1)" (`MM:.github/actions/runner-prep-openldap/action.yml:2-12`). Mattermost also retries start-up: "osixia/openldap is known to occasionally fail its first boot under load" (`MM:e2e-tests/playwright/lib/src/containers/openldap_container.ts:13-14`). ldapts runs 1.5.0 on `ubuntu-latest` without that sysctl (`LT:.github/workflows/ci.yml:41-45`). Whether WSL2 hits it is ?.
- `latest` will probably move to v2: the `stable` tag is being removed (Hub banner). GitLab QA uses `osixia/openldap` at tag `latest` (`GQ:lib/gitlab/qa/component/ldap.rb:21-22`), and n8n's manual-test doc uses `osixia/openldap:latest` with v1 variables (`N8:packages/cli/src/modules/ldap.ee/README.md:12-15`). Both would break when it moves.

### 3.6 `bitnami/openldap` — not usable

The Docker Hub repository has no tags. Its description reads: "This image is no longer available for free through Docker Hub. This image is available … through a commercial subscription of Bitnami Secure Images". The announcement says: "As of August 28th, 2025 … Disable images generation for Debian-based images and gradually move existing ones to a Bitnami Legacy repository … free images … only available on the 'latest' tag … at hub.docker.com/u/bitnamisecure" (bitnami/containers issue #83267, opened 2025-07-16). `bitnamisecure/openldap` does not exist (Hub API 404). `bitnamilegacy/openldap` is frozen at `2.6.10-debian-12-r4` (2025-08-19) and labelled "Legacy Bitnami images (no longer updated)". The Dockerfiles stay public under Apache-2.0 (`BN:bitnami/openldap/2.6`, `2.7`), but building our own copy is a maintenance burden the alternatives avoid.

### 3.7 Other OpenLDAP images

- **`vegardit/openldap`**: Debian trixie slapd 2.6, "Automatically rebuilt weekly" (`VG:README.md:25-31`). LDIF dirs `/opt/ldifs/custom/` (data) and `/opt/ldifs/custom-schema/` (`VG:README.md:156-161`). "Modules and overlays need separate configuration" (`:184`), so memberOf, ppolicy and nestgroup need config LDIF too. A viable non-alpha fallback for 3.4. Whether Debian's slapd 2.6.10 package includes `nestgroup.so` is ?.
- **`ghcr.io/rroemhild/docker-test-openldap`**: a fixed Futurama dataset with memberOf, StartTLS and LDAPS (`rroemhild-README.md:15-51`), on Debian bookworm. It suits fixed-fixture unit tests, but the hub needs its own groups, nesting and a disabled user.
- **`gitea/test-openldap`** (Gitea CI, pinned by digest, `GT:.github/workflows/pull-db-tests.yml:30-31`) is a 2019 image. **`ghcr.io/nextcloud/continuous-integration-openldap`** is Nextcloud's own build (`debian:trixie-slim`, slapd 2.6.10, `NCD:openldap/Dockerfile:5-13`). Both are project-specific.
- **`cleanstart/openldap`**: OpenLDAP 2.7.1 from a hardened-image vendor. No CI precedent was found, and its terms were not checked.

### 3.8 `389ds/dirsrv`

The official 389 DS container ("This docker image is build in the opensuse buildservice", `hub-389ds_dirsrv.md`). Its newest tag `3.1` is from 2025-06-24 while upstream released 3.3.1 on 2026-09-07, and it is amd64 only. With `DS_SUFFIX_NAME` it creates the backend and suffix entry; otherwise "No backends or suffixes are created by default" (`389:src/lib389/cli/dscontainer:226-308,489`). There is no seed hook at start, so data goes in through `dsconf`/`dsidm`/ldapadd afterwards.

| H5 entryUUID | H8 memberOf | H10 nesting | H3 disabled | H11 paged | H2/H4/H9 | H13 | H17 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Y: `cn=entryuuid` plugin `nsslapd-pluginenabled: on` (`389:ldap/servers/slapd/fedse.c:135-142`) | P: MemberOf plugin `nsslapd-pluginenabled: off` by default (`389:ldap/ldif/template-dse.ldif.in:673-681`) | Y via memberOf values: "Add indirect group membership memberOf values" (`389:ldap/servers/plugins/memberof/memberof.c:4643`), unless `skip_nested` (`:3796`) | Y: `nsAccountLock` (`389:ldap/schema/02common.ldif:128`; `dsidm account lock`, `389:src/lib389/lib389/idm/account.py:189-199`) | Y | N | Y (`/data/tls/{server.key,server.crt,ca/*.crt}`) | N |

It covers the generic needs but has a stale image, the heaviest footprint of the OpenLDAP-class options (caches autotuned from `DS_MEMORY_PERCENTAGE`), and no declarative seed. Not recommended.

### 3.9 `lldap/lldap`

`entryUUID` yes (text; `LL:crates/ldap/src/core/user.rs:86,139`). `memberOf` yes, direct only ("Testing group membership through memberOf is supported", `lldap-README.md:167-168`). It advertises no controls: `supportedControl` is empty (`LL:crates/ldap/src/search.rs:147-150`), so there is no paging. Unknown filter types get `UnwillingToPerform` "Unsupported user filter" (`LL:crates/ldap/src/core/user.rs:374-377`), which is the opposite of RFC 4511's "MUST NOT return errors". No disabled-user flag or nested groups were found in the README or source read. The DIT is fixed (`ou=people`, `ou=groups`), and seeding goes through `bootstrap.sh` over GraphQL after start (`lldap-bootstrap.md:3-37`). "The goal is not to provide a full LDAP server" (`lldap-README.md`). Not suitable as the generic reference server.

### 3.10 `glauth/glauth`

Users and groups live in a TOML config. `disabled = true` adds `accountStatus: inactive` and refuses the bind (`GA:v2/pkg/handler/config.go:202-204`; `ldapopshelper.go:105-107`). Groups nest through `includegroups` (`config.go:340,381,418`), and `memberOf` is emitted (`config.go:229`). The attribute list has no `entryUUID` or `objectGUID` (`config.go:180-235`). Paging code in the LDAP-proxy backend is commented out (`GA:v2/pkg/handler/ldap.go:215-246`); paging in the config backend is ?. It is a configurable fake rather than a directory. Not suitable.

### 3.11 Coverage summary

|  | H2 AD filter | H3 disabled | H4 objectGUID | H5 entryUUID | H8 memberOf | H9 in-chain | H10 nesting other | H11 paged | H12 forced paging | H13/14 TLS | H16 unprivileged | H17 seed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| smblds | Y | Y | Y | N | Y | Y | — | Y | **N** | Y/Y | Y | P (scripts) |
| samba-ad-server | Y | Y | Y | N | Y | Y | — | Y | N | Y/Y | **N** | P (JSON) |
| osixia 2.6.15-alpha | N | P (ppolicy) | N | Y | Y | N | P (nestgroup) | Y | **Y** (limits) | Y/Y | Y | Y (LDIF) |
| osixia 1.5.0 | N | P | N | Y | Y | N | N | Y | Y | Y/Y | Y (? sysctl) | Y |
| vegardit 2.6 | N | P | N | Y | P | N | ? | Y | Y | Y/Y | Y | Y |
| 389ds 3.1 | N | Y | N | Y | P | N | Y | Y | ? | Y | Y | N |
| lldap | N | N | N | Y | Y | N | N | N | N | Y | Y | P |
| glauth | N | Y | N | N | Y | N | Y | ? | ? | Y | Y | Y (TOML) |

---

## 4. CI precedents (pinned)

| Project | Server image | Seed | Source |
| --- | --- | --- | --- |
| **ldapts** (the hub's client) | `osixia/openldap:1.5.0@sha256:18742e9c…` with TLS (generated CA, `LDAP_TLS_VERIFY_CLIENT: allow`) | LDIF in `bootstrap/ldif/custom`; certs generated by `node tests/data/generate-certs.mjs` (node-forge, SAN `localhost`) | `LT:docker-compose.yml:1-32`; `LT:.github/workflows/ci.yml:41-45`; `LT:tests/data/ldif/10-users.ldif`; `LT:tests/data/generate-certs.mjs:50-66` |
| **authentik** | `ghcr.io/beryju/test-samba-dc:v1.0` (cap SYS_ADMIN) **and** `osixia/openldap:2.6.10-alpha@sha256:80a577d7…` | Samba: the image's own start script provisions OUs, groups and users with `samba-tool` (`BeryJu/test-samba-dc@96fb12ae:scripts/start.sh:20-29`); OpenLDAP: mounted `10-users.ldif` + generated certs; tests retry on `LDAPSessionTerminatedByServerError` | `AK:tests/e2e/compose.yml:57-62` (pinned under a never-started `pin-only` profile so Dependabot bumps them, `:25-27`); `AK:tests/e2e/test_source_ldap_samba.py:25-38`; `AK:tests/e2e/test_source_ldap_sasl_external.py:138-185` |
| **os2mo-ldap-import-export** (Magenta ApS, OS2mo AD integration) | `smblds/smblds:latest` (`INSECURE_LDAP`, `INSECURE_PASSWORDSETTINGS`) **and** `osixia/openldap:1.5.0` | Samba: LDAP adds from test fixtures; OpenLDAP: LDIF + custom schema | `O2:docker-compose.yml:7-49`; `O2:.gitlab-ci.yml:85-119`; `O2:tests/integration/conftest.py:79-153` |
| Mattermost | `osixia/openldap:1.4.0` | LDIF fixtures via Cypress/Playwright helpers | `MM:server/build/docker-compose.common.yml:53-63`; `MM:e2e-tests/playwright/lib/src/containers/default_images.ts:9`; `openldap_container.ts:13-37`; `.github/actions/runner-prep-openldap/action.yml:1-44` |
| Grafana (devenv, not CI) | `osixia/openldap` (unpinned) | `prepopulate/*.ldif` via `LDAP_SEED_INTERNAL_LDIF_PATH` | `GF:devenv/docker/blocks/auth/openldap/docker-compose.yaml:1-19`; also `devenv/docker/blocks/auth/{freeipa,authentik}` |
| GitLab QA | `osixia/openldap:latest` | LDIF in `bootstrap/ldif/custom` | `GQ:lib/gitlab/qa/component/ldap.rb:5-25,60-75` |
| Nextcloud `user_ldap` | own `ghcr.io/nextcloud/continuous-integration-openldap:openldap-8` (slapd 2.6.10, memberof) | baked-in LDIFs + PHP setup scripts | `NC:.github/workflows/integration-sqlite.yml:84-93`; `NCD:openldap/Dockerfile:5-29`; `NC:apps/user_ldap/tests/Integration/run-test.sh` |
| Gitea | `gitea/test-openldap:latest@sha256:4ac633b0…` (2019 image) | baked-in | `GT:.github/workflows/pull-db-tests.yml:30-31,66-67` |
| Keycloak | embedded ApacheDS in the test JVM; AD-only tests skip unless the configured vendor is AD | `default-users.ldif` | `KC:testsuite/integration-arquillian/tests/base/src/test/resources/ldap/ldap-connection.properties:18-25`; `KC:…/federation/ldap/LDAPMSADMapperTest.java:59-66`; `KC:util/embedded-ldap/pom.xml:65` |
| n8n | no automated server; the manual-test doc uses `osixia/openldap:latest` + `ldapadd` | heredoc LDIF | `N8:packages/cli/src/modules/ldap.ee/README.md:3-31` |
| Backstage | no LDAP server in the repo (code search: only docs mention OpenLDAP) | — | `backstage/backstage@75128025:docs/integrations/ldap/org.md:16` |

Pattern: projects that support AD **and** generic LDAP (authentik, os2mo) run a Samba DC next to an OpenLDAP. Projects that cannot run AD in CI keep AD-only tests behind a switch that turns them on against a real AD (Keycloak, `LDAPMSADMapperTest.java:59-66`). That is the shape of §5 plus §6.

---

## 5. Recommendation

### 5.1 Two servers, opt-in

1. **AD-like: `smblds/smblds` pinned by digest.** It is the only Samba image built for CI that runs unprivileged and is in CI use elsewhere (os2mo). It covers H2–H4, H6–H9, H11, H13–H16 with real Samba code. Keep its secure default (no `INSECURE_LDAP`) and connect over **LDAPS (636) or StartTLS (389)**. That tests the TLS path production AD will most likely require (Samba's default matches `LdapEnforceChannelBinding=2`). If TLS on the AD-like server costs too much at first, `INSECURE_LDAP=true` is the documented switch (os2mo uses it), and TLS is then covered on the generic server only.
2. **Generic: `osixia/openldap:2.6.15-alpha` pinned by digest** (non-alpha fallback: `vegardit/openldap:2.6.x`). It covers H5, uid login, inetOrgPerson, groupOfNames with memberOf, nested groups through `nestgroup`, a ppolicy-locked user, LDAPS/StartTLS with a test CA, and **H12 forced paging** through `olcLimits` on the service account. H12 is the one important behaviour Samba lacks.
3. Put both under a Compose **profile** (for example `profiles: [ldap]`) so the existing suite and the dev box's memory are unchanged unless LDAP specs run. Bind ports to `127.0.0.1` only, as the e2e MySQL does (`docker-compose.e2e.yml:20-21`). Give each a `mem_limit` once `docker stats` has measured it (§7).
4. Combined download is about 70 MB compressed (54 + 15). Both start from scratch every run: Samba provisions a domain at each fresh start, and osixia bootstraps when its config is empty.

If the owner wants **one** server, keep smblds. The generic path (text `entryUUID`, `uid`, groupOfNames, ppolicy, forced paging) would then rest on unit tests and documentation only. Since the hub must work "with any LDAPv3 server through settings", and OpenLDAP is the smaller image, two is the better trade.

### 5.2 Seeding sketch (untested; for the B3b plan, not a verified config)

AD-like (`e2e/fixtures/ldap/ad/entrypoint.d/10-seed.sh`, mounted read-only at `/entrypoint.d/`, executable bit set in git because the entrypoint skips non-executable files, `SMB:entrypoint.sh:116-124`). It is made idempotent with a marker, as sambacc does (`SCC:sambacc/commands/addc.py:43,160-186`):

```sh
#!/bin/sh
set -e
[ -f /var/lib/samba/.e2e-seeded ] && exit 0
samba-tool user add svc-hub 'Svc!Passw0rd1' --given-name=Hub --surname=Service
samba-tool user add alice 'Alice!Passw0rd1' --given-name=Alice --surname=Admin --mail-address=alice@e2e.hub.test
samba-tool user add bob   'Bob!Passw0rd1'   --given-name=Bob   --surname=Builder --mail-address=bob@e2e.hub.test
samba-tool user add carol 'Carol!Passw0rd1' --given-name=Carol --surname=Gone   --mail-address=carol@e2e.hub.test
samba-tool user disable carol                       # H3
samba-tool group add hub-admins
samba-tool group add engineering
samba-tool group add backend
samba-tool group addmembers engineering backend     # nesting: backend inside engineering (H9)
samba-tool group addmembers backend bob
samba-tool group addmembers hub-admins alice
touch /var/lib/samba/.e2e-seeded
```

Compose sketch: `image: smblds/smblds:latest@sha256:563ba62d…`, `hostname: dc`, `environment: {REALM: E2E.HUB.TEST, DOMAIN: E2EHUB, ADMINPASS: <test value>}`, `ports: ['127.0.0.1:10636:636', '127.0.0.1:10389:389']`, plus a `healthcheck` that runs the image's `ldapsearch` wrapper (`-b '' -s base`). The hub's settings in the spec would be: base `DC=e2e,DC=hub,DC=test`, bind as `svc-hub@e2e.hub.test` or its DN, id attribute `objectGUID` (binary), login `sAMAccountName`, group filter `(member:1.2.840.113556.1.4.1941:={dn})`, and user filter `(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))`.

Generic (`e2e/fixtures/ldap/generic/`): `data/10-tree.ldif` (`ou=people`, `ou=groups`), `data/20-users.ldif` (inetOrgPerson with `uid`, `mail`, `displayName`, `userPassword: {SSHA}…`, one user with `pwdAccountLockedTime: 000001010000Z`, more users than the service account's size limit), `data/30-groups.ldif` (groupOfNames, one group whose `member` is another group); `config/…` with the `nestgroup` overlay (`olcNestGroupBase: ou=groups,…`, `olcNestGroupFlags: member-filter` / `memberof-values`) and `olcLimits: dn.exact="cn=svc-hub,…" size.soft=5 size.hard=5 size.prtotal=unlimited`; `certs/` holding a test CA and a server cert with SAN `localhost`, as ldapts generates them (`LT:tests/data/generate-certs.mjs:50-66`) or as authentik builds them (`AK:tests/e2e/test_source_ldap_sasl_external.py:104-125`). Environment: `OPENLDAP_BOOTSTRAP_SUFFIX=dc=e2e,dc=hub,dc=test`, `OPENLDAP_BOOTSTRAP_MEMBEROF=true`, `OPENLDAP_BOOTSTRAP_PPOLICY=true`, `OPENLDAP_BOOTSTRAP_TLS=true`, `OPENLDAP_BOOTSTRAP_MODULES="<default list> nestgroup.so"`, fixed `…_ROOT_PASSWORD_HASHED`. Healthcheck as authentik's: `ldapsearch -x -H ldap://localhost:3890 -b "" -s base` (`AK:…sasl_external.py:142-157`). Settings: id `entryUUID`, login `uid`, user filter `(&(objectClass=inetOrgPerson)(!(pwdAccountLockedTime=*)))`, group filter `(&(objectClass=groupOfNames)(member={dn}))`, made transitive by nestgroup.

Reset: `docker compose -f docker-compose.e2e.yml --profile ldap down -v`, because smblds' anonymous volumes survive a plain `down` (§3.1).

### 5.3 What each server should prove in e2e

- **Samba:** sign-in with `sAMAccountName` and with the UPN form if the hub accepts it; binary `objectGUID` stored and stable across a rename (`samba-tool user rename`); a disabled user is filtered out at sign-in and deactivated at sync; nested-group membership through 1941; wrong password gives 49; plain `ldap://` without TLS is refused while `INSECURE_LDAP` is off (the hub reports a TLS-required error clearly).
- **OpenLDAP:** text `entryUUID`; `uid` login; a ppolicy-locked user is filtered out and its bind is refused; nested membership through nestgroup; **the sync pages** (an unpaged search over the service account's limit fails with `SizeLimitExceededError`, the paged sync sees every user); LDAPS and StartTLS with the test CA, and a wrong CA fails; AD defaults left on a generic server produce "0 users", reported clearly.

---

## 6. What stays for the owner's live AD check

1. **`MaxPageSize` = 1000 and the other LDAP policies** (`MaxConnIdleTime` 900 s etc., MS-ADTS 3.1.1.3.4.6, see `ldap-client.md` §6.1). Samba does not enforce the page limit (§3.1 H12). A sync of more than 1000 users on the real AD, or at least a confirmed `pagedResults` exchange, is the only end-to-end proof. OpenLDAP's limit test (§5.3) covers the client logic.
2. **Referrals / continuation references** from a search at the domain root (`DomainDnsZones`, `ForestDnsZones`, child domains, multi-domain forests). Whether smblds returns them like AD is ?. The live check should confirm that the sync ignores them and does not fail on them.
3. **Channel binding and signing policy** as actually configured on the production DCs (LDAPS vs StartTLS, `LdapEnforceChannelBinding`, the CA chain the hub must trust).
4. **AD error sub-codes** in the 49 diagnostic (`data 52e/533/701/773/775`: bad password, disabled, expired, must change, locked out), and lockout (`lockoutTime`) / expiry (`accountExpires`, `pwdLastSet`) semantics, if the hub maps them to messages.
5. **Scale and latency** of the `1.2.840.113556.1.4.1941` group query on the real group tree. Microsoft's ADSI Search Filter Syntax page warns "Some such queries on subtrees may be more processor intensive" (quoted in `tmp/b3-research/ldap-client.md:322`).
6. **The real attribute data**: which users lack `mail`, how display names look, `objectGUID` matching between the hub's stored form and AD tools, and the service account's read rights on `userAccountControl` and `memberOf`.

---

## 7. Not confirmed

- **Memory footprint** of every candidate: none publishes a number (smblds, samba-ad-server, osixia v1/v2, vegardit, 389ds, lldap ("low resources"), glauth ("lightweight")). Measure each once with `docker stats --no-stream` on the dev box, then set `mem_limit`. Only compressed image sizes are known (§2).
- **Start-up time**: not documented for any candidate. Samba provisions a fresh domain at every clean start (`SMB:entrypoint.sh:37-54`). authentik retries Samba tests on `LDAPSessionTerminatedByServerError` (`AK:tests/e2e/test_source_ldap_samba.py:38`), and Mattermost retries osixia 1.4.0's first boot. Give both healthchecks a `start_period`.
- smblds: whether `tmpfs` works for `/var/lib/samba` and `/etc/samba`; the exact result code and diagnostic for a disabled account's bind; whether it returns AD-like referrals; that no `MaxPageSize`-style entry limit exists anywhere (only the 256 MiB reply cap and `MaxQueryDuration` were found).
- osixia v2: the exact config LDIF for `nestgroup` against its bootstrap templates (module entry index, overlay order beside `memberof`); whether `pwdAccountLockedTime` in a data LDIF is accepted by its bootstrap path; whether the v2 variable names stay stable before a non-alpha release.
- osixia 1.x on WSL2: whether the AppArmor user-namespace failure Mattermost saw on Ubuntu 24.04 applies (ldapts' CI on `ubuntu-latest` does not hit it).
- vegardit: whether Debian's slapd 2.6.10 package ships `nestgroup.so`.
- 389ds: forced-paging limits (`nsslapd-sizelimit`, `nsPagedSizeLimit`) were not checked.
- glauth: paging in its config backend.
- `instantlinux/docker-tools` licence was read from the repository (Apache-2.0); the licence of the Samba binaries inside is GPL-3.0 as for every Samba image (licences matter little for throwaway test containers that are not redistributed).

---

## 8. Pinned sources

Images (registry APIs read 2026-10-09):

- Docker Hub: `smblds/smblds` (latest `sha256:563ba62d5d7e1914671f30d716435e7dd2d074eb500c4937dbb96ea04f269fd7`, 2026-10-08), `osixia/openldap` (`2.6.15-alpha` `sha256:de37b295c8f11f6654a2376f7b5f9d5e9d028bd2f50713751f99ed270f7abbec`; `1.5.0` 2021-02-19), `bitnami/openldap` (0 tags), `bitnamilegacy/openldap` (`2.6.10-debian-12-r4`, 2025-08-19), `389ds/dirsrv` (`3.1`, 2025-06-24), `lldap/lldap` (2026-09-22), `glauth/glauth` (`v2.5.4`, 2026-09-13), `diegogslomp/samba-ad-dc` (`4.25.0`, 2026-09-28), `nowsci/samba-domain` (2026-10-01), `instantlinux/samba-dc` (`4.23.10-r0`, 2026-10-07), `vegardit/openldap` (2026-10-07), `cleanstart/openldap` (2026-10-08), `rroemhild/test-openldap` (archived), `gitea/test-openldap` (2019-07-11), `openldap/openldap` (placeholder), `library/openldap` (absent), `dwimberger/ldap-ad-it` (2017, dead).
- Quay: `samba.org/samba-ad-server` (`v0.9` `sha256:81110901f7e7e6af2e80581611729fb99a54522bd500065002550f2f5e1b38f9`, 2026-06-18; `latest` 2026-10-08), `389ds/dirsrv` (`latest` 2025-06-22).
- Docker Hub descriptions saved as `tmp/b3-research/e2e-ldap/hub-*.md`.

Repositories (full SHAs; also in `tmp/b3-research/e2e-ldap/pins.txt`):

- smblds/smblds-container@84fe79e6a032490de6eea630a5e8133eedf1353d — `Dockerfile`, `entrypoint.sh`, `healthcheck.sh`, `.github/workflows/image.yml`
- samba-in-kubernetes/samba-container@60777e4af35e3aa9a9d6e77131e27cc07228bee9 — `README.md`, `images/ad-server/Containerfile.fedora`, `examples/kubernetes/samba-ad-server-deployment.yml`
- samba-in-kubernetes/sambacc@7e2e1b69ea51029588af10c8a94cf8c5e953bba2 — `docs/configuration.md`, `examples/addc_ou.json`, `sambacc/addc.py`, `sambacc/commands/addc.py`
- samba-team/samba@f28e9e6df8ae8fd6208804fb1440de5db35ba047 — `lib/ldb-samba/ldb_matching_rules.{c,h}`, `lib/ldb/include/ldb.h`, `lib/ldb/common/ldb_match.c`, `source4/dsdb/samdb/ldb_modules/{paged_results,objectguid,samldb}.c`, `source4/ldap_server/{ldap_server.h,ldap_backend.c}`, `source4/lib/tls/tlscert.c`, `python/samba/netcmd/group.py`, `python/samba/netcmd/user/add.py`, `python/samba/samdb.py`
- Samba docs: smb.conf(5) and samba-tool(8) for 4.25.0 (https://www.samba.org/samba/docs/current/man-html/); wiki "Setting up Samba as an Active Directory Domain Controller" and "Configuring LDAP over SSL (LDAPS) on a Samba AD DC" (raw wikitext, 2026-10-09)
- openldap/openldap@ae910be781fe723f88fdc28b6a1fc6f1f1ce07c4 (master) — `servers/slapd/schema_init.c`, `servers/slapd/overlays/nestgroup.c`, `doc/man/man5/slapo-nestgroup.5`; openldap/openldap@f46b74e75a9b79fec76655a9456ce643566d9558 (OPENLDAP_REL_ENG_2_6) — `CHANGES`; OpenLDAP 2.6 Admin Guide, slapo-memberof(5), slapo-dynlist(5), slapo-ppolicy(5) (saved in `tmp/b3-research/openldap/`)
- Alpine: aports `3.24-stable/main/openldap/APKBUILD`; pkgs.alpinelinux.org (openldap 2.6.15-r0, `nestgroup.so` in `openldap`; samba-dc 4.23.8-r0)
- osixia/container-openldap@6e26809af9d9b6ac341b704e8e90730fa6e7bcb3 (develop, v2) — `Dockerfile`, `CHANGELOG.md`, `services/openldap-bootstrap/assets/ldif/README.md`, `…/config/memberof/160-overlay-memberof-database.ldif.template`; tag `v1.5.0` — `README.md`, `CHANGELOG.md`, `image/Dockerfile`
- vegardit/docker-openldap@8331dc432030abcf30df0c47665f647e5f382e98 — `README.md`
- rroemhild/docker-test-openldap@07f302d78bfc482c8b220e2fcafbe64bf852616a — `README.md`, `Dockerfile`
- bitnami/containers@9943e77f991238068d808ae617a1275090b406c7 — `README.md`, `bitnami/openldap/`; issue #83267 "Upcoming changes to the Bitnami catalog (effective August 28th, 2025)"
- 389ds/389-ds-base@6ab091c6dcd2d80de919d67089c6ccff74437448 — `src/lib389/cli/dscontainer`, `ldap/servers/slapd/fedse.c`, `ldap/ldif/template-dse.ldif.in`, `ldap/servers/plugins/memberof/memberof.c`, `ldap/schema/02common.ldif`, `src/lib389/lib389/idm/account.py`
- lldap/lldap@99c510a7a603df1cdaca00a9ffff95ec73b296eb — `README.md`, `crates/ldap/src/core/user.rs`, `crates/ldap/src/search.rs`, `example_configs/bootstrap/bootstrap.md`, `lldap_config.docker_template.toml`
- glauth/glauth@251ec3ef667e7e51f4b38c3f52c048f7f20dfc32 — `v2/pkg/handler/{config,ldapopshelper,ldap}.go`, Hub README
- ldapts/ldapts@e670417788d7841dafd969d0597421db1950e656 — `docker-compose.yml`, `.github/workflows/ci.yml`, `tests/data/ldif/*`, `tests/data/generate-certs.mjs` (local copy `tmp/b3-research/src/ldapts/repo`)
- goauthentik/authentik@c3f92b69f6f5be549dd570d71ad1d19763e36827 — `tests/e2e/compose.yml`, `tests/e2e/test_source_ldap_samba.py`, `tests/e2e/test_source_ldap_sasl_external.py`; BeryJu/test-samba-dc@96fb12ae1539536502d5c743aaa6c59adf95e01b — `Dockerfile`
- magenta-aps/os2mo-ldap-import-export@eea33ecf4a0e79c31678066f3d6a483bd30e3dc3 — `docker-compose.yml`, `.gitlab-ci.yml`, `tests/integration/conftest.py`
- mattermost/mattermost@4d94455ab041c0eed6676064cd8b033e9912fc5b — `.github/actions/runner-prep-openldap/action.yml`, `e2e-tests/playwright/lib/src/containers/{openldap_container,default_images}.ts`, `server/build/docker-compose.common.yml`, `server/docker-compose.yaml`
- grafana/grafana@7b702d7969564cb677ae3e3f393dedd6f867264e — `devenv/docker/blocks/auth/openldap/{docker-compose.yaml,README.md}`
- gitlab-org/gitlab-qa@d18bf530ac933c2ea6e9daf850b4657abe4456c1 (gitlab.com) — `lib/gitlab/qa/component/ldap.rb`
- nextcloud/server@859e88ab4d3254d763814933d3393c47005833ec — `.github/workflows/integration-sqlite.yml`, `apps/user_ldap/tests/Integration/run-test.sh`; nextcloud/docker-ci@9e96f78a3e368c332e5f5e717fd15ca922276e47 — `openldap/Dockerfile`
- keycloak/keycloak@c7de391ae4d8a83ad62b8386cab85d37fbb6324c — `testsuite/integration-arquillian/tests/base/src/test/resources/ldap/ldap-connection.properties`, `…/federation/ldap/LDAPMSADMapperTest.java`, `util/embedded-ldap/pom.xml`
- go-gitea/gitea@c0a8eb8e741b02812e323a0ef2c448af862324b0 — `.github/workflows/pull-db-tests.yml`
- n8n-io/n8n@6fc0aeda35ea62ee353dd80b0f8d3e0f1f4e50d0 — `packages/cli/src/modules/ldap.ee/README.md`
- backstage/backstage@75128025b788bb70e46553141a9a66f80777116c — `docs/integrations/ldap/org.md`
- docker/docs@858251609b8884594fd1de29c51155bc3024b260 — `_vendor/github.com/docker/compose/v5/docs/reference/compose_down.md`
- RFCs 4511, 4512, 4530 (saved in `tmp/b3-research/`); Microsoft "Enable LDAP signing in Windows Server" (saved in `tmp/b3-research/ms/enable-ldap-signing.md`)
