# B3b plan research: the LDAP test servers (certificates, seeding, healthchecks, harness, memory)

Date: 2026-10-10. Branch `feat/backend-b3b-directory` at `4eb07c21`. Scope: make the two test directories that the B3b plan adds to `docker-compose.e2e.yml` (spec §8: `smblds/smblds` over LDAPS for Playwright and `pnpm test:ldap`, OpenLDAP 2.6 over StartTLS and plain for `pnpm test:ldap`) as right as possible from documentation and source, so that the plan's pre-flight can run them once. It builds on `../e2e-ldap-server.md` (the server choice; not redone).

Method: no image was pulled or run and no container was started. Sources: registry metadata (Docker Hub v2 API, Quay API, `docker buildx imagetools inspect`, which reads manifests and config blobs only), the images' source at pinned commits, product source at pinned commits, man pages and docs (crawl4ai, Context7, GitHub raw). On this machine: `openssl` is `/usr/bin/openssl`, "OpenSSL 3.0.13 30 Jan 2024"; Node is v24.16.0; Docker Engine 29.3.1; Docker Compose v5.1.1. Working copies are in `tmp/b3b-ldap-servers/` (git-ignored). Everything in §7 is **UNTESTED**.

Short SHAs (full ones in §8): `SMB`=smblds/smblds-container@84fe79e6 (HEAD, unchanged since 2026-10-01), `SAM`=samba-team/samba@f28e9e6d, `OSX`=osixia/container-openldap@6e26809a (develop = v2, HEAD 2026-10-08), `VG`=vegardit/docker-openldap@8331dc43 (HEAD), `OL26`=openldap/openldap@f46b74e7 (OPENLDAP_REL_ENG_2_6), `LT`=ldapts/ldapts@e6704177, `NODE`=nodejs/node@ae5a0f40, `N24`=nodejs/node tag v24.16.0, `PL`=python-ldap/python-ldap@b47ed474, `GO`=golang/go@dfe2e7bf, `AK`=goauthentik/authentik@c3f92b69.

---

## 0. Headline: what changes or sharpens the spec and `e2e-ldap-server.md`

1. **Use one committed test CA and server certificate.** The CA key is thrown away after signing, and a regeneration script uses the openssl CLI (python-ldap's pattern). The files must not be named `*.pem`: the root `.gitignore` has `*.pem` (line 25), and `git check-ignore` confirms that `e2e/fixtures/ldap/certs/ca.pem` would be ignored. Use `.crt` and `.key`. GitHub would not flag them on this repository today: the API reports `secret_scanning_non_provider_patterns: disabled`, and generic private-key patterns are "Not supported" by default push protection. (§1)
2. **The Samba key must be copied into the container, not bind-mounted.** Samba refuses a key whose owner is not its effective uid or whose mode is not exactly 0600 ("This is known as CVE-2013-4476", `SAM:source4/lib/tls/tls_tstream.c:1578-1591`, `lib/util/util.c:161-176`). A file bind-mounted from WSL is owned by uid 1000, so an `/entrypoint.d` script copies it with `install -m 0600 -o root`. smblds issue #29 reports the same failure on Windows. (§1, §7.3)
3. **The smblds built-in HEALTHCHECK reports healthy before Samba runs.** `healthcheck.sh` is `[ -f /tmp/samba.daemon-expected ] && pidof samba` followed by `exit 0`. The hint file is created only when Samba is started (`entrypoint.sh:130,134`), so during provisioning and during the `/entrypoint.d` scripts the check exits 0. `e2e-ldap-server.md` §3.1 said it "only checks that the samba process exists"; it is weaker than that. Override it. (§3)
4. **osixia v2 seeds its data with `slapadd`, so the memberof overlay never fills `memberOf` for seeded entries.** Bootstrap runs `slapadd -n 1 -F … -l …` (`OSX:services/openldap-bootstrap/startup.sh:103`). An overlay copies the backend's `BackendInfo` and replaces only the `bi_op_*`, entry and ACL hooks, not the `bi_tool_*` ones (`OL26:servers/slapd/backover.c:1375-1425`), so slapadd bypasses every overlay. The seed LDIF therefore carries `memberOf` itself, consistent with `member`, or the data is seeded online. `slapo-nestgroup` builds on stored `memberOf` values. (§4)
5. **vegardit is not a drop-in fallback.** Its data LDIF goes in online (`ldapmodify -a`), so `memberOf` is maintained. But its memberof overlay is set for `groupOfUniqueNames`/`uniqueMember` (`VG:image/ldifs/init_module_memberof.ldif`). Its README says not to use the data folder "to change `cn=config`, add schemas, or load modules" and that "Modules and overlays need separate configuration". `olcLimits` and nestgroup therefore need a post-start `ldapmodify` by the harness. `LDAP_TLS_SSF=128` by default "rejects … ordinary clear-text connections", so the `none` test needs `LDAP_TLS_SSF=0` there. (§4)
6. **Do not use `size.pr` to force paging.** OpenLDAP answers adminLimitExceeded "illegal pagedResults page size" when a client asks for a page above `size.pr` (`OL26:servers/slapd/limits.c:1168-1177`); AD silently caps the page. Use `size.soft=5 size.hard=5 size.prtotal=unlimited` on the service account only. (§4)
7. **`servername` should default to the URL host only when that host is a DNS name.** Node prints `[DEP0123] DeprecationWarning: Setting the TLS ServerName to an IP address is not permitted by RFC 6066` (observed here on Node 24.16.0). The identity check does not need `servername`: Node checks `options.servername || options.host || options.socket?._host || 'localhost'` (`N24:lib/internal/tls/wrap.js:1661-1666`). ldapts' `startTLS()` passes only `{ socket, …options }` (`LT:src/Client.ts:273-291`), and the original socket's `_host` is the URL host. So the hub sets `servername` only when `net.isIP(host) === 0`. The e2e URLs use `127.0.0.1`, and the certificate carries `IP:127.0.0.1`. (§1)
8. **Harness coupling.** (a) With the `LDAP_*` block in `.env.e2e`, the login page's default tab becomes "Directory account" (spec §6.3). Every existing local sign-in helper (`e2e/auth.setup.ts`, `signInAs` in `e2e/fixtures/users.ts`) must select "Local account" first. (b) A re-provisioned Samba issues new `objectGUID`s while the reused e2e MySQL keeps the old `directory_id`s. The next first sign-in would then hit the email-collision refusal. B3b specs should delete `source = 'ldap'` accounts (and their links) before they run, through `e2e/fixtures/db.ts`. (§5)

---

## 1. TLS certificates for the tests

**Verdict.** Commit a long-lived test CA certificate (`ca.crt`) and a server certificate and key (`server.crt`, `server.key`) for SAN `DNS:localhost, IP:127.0.0.1, IP:::1` (plus the Compose service names), under `e2e/fixtures/ldap/tls/`. Add a `generate.sh` that recreates them with the openssl CLI and discards the CA key. Both servers mount the same three files. Samba gets copies at the paths set in `smb.conf` (`tls keyfile/certfile/cafile`); osixia gets `OPENLDAP_BOOTSTRAP_TLS_CERT/_CERT_KEY/_CA_CERT`. The hub's `LDAP_CA_FILE` is `e2e/fixtures/ldap/tls/ca.crt`, relative to the repository root; Playwright's webServer runs from the config's directory and Vitest from the root.

### 1.1 What each server documents

**Samba (smblds).** The Samba wiki: "By default TLS is enabled (`tls enabled = yes`), the above files are used and correspond to the following smb.conf parameters: tls enabled = yes / tls keyfile = tls/key.pem / tls certfile = tls/cert.pem / tls cafile = tls/ca.pem". For a custom certificate: "Add the following to your smb.conf … Restart Samba" (wiki "Configuring LDAP over SSL (LDAPS) on a Samba AD DC", saved `tmp/b3-research/e2e-ldap/samba-wiki-…LDAPS….wiki.txt:57-107`). The wiki also says "The private key must be accessible without a passphrase" and "The files that samba uses have to be in PEM format" (`:13-15`). smb.conf(5): "tls keyfile … must not be encrypted. This path is relative to private dir if the path does not start with a /." It also documents "tls certfile", "tls cafile … Default: tls cafile = tls/ca.pem" (`smb.conf.5.txt:8920-8961`). The private dir in Alpine is `/var/lib/samba/private` (the path used in smblds issue #29).

Source facts the docs do not state:

- Generation is skipped when the CA file exists: `if (!file_exist(ca_file)) { tls_cert_generate(…) }` (`SAM:source4/lib/tls/tls_tstream.c:1572-1576`).
- The key check: `if (file_exist(key_file) && !file_check_permissions(key_file, geteuid(), 0600, &st))` logs "Invalid permissions on TLS private key file … This is known as CVE-2013-4476." and fails TLS setup (`:1578-1591`). `file_check_permissions` requires `pst->st_uid == uid` and `(pst->st_mode & 0777) == file_perms` exactly (`SAM:lib/util/util.c:161-176`).
- smblds issue #29 (open, 2026-08-19), with a bind-mounted key on Docker Desktop for Windows: "invalid permissions on file '/var/lib/samba/private/tls/key.pem': has 0777 should be 0600". The reporter's working fix is to copy the files and `chmod 600` them before Samba starts. The maintainer's reply: "Docker Desktop for Windows (including its limitations) was never part of the initial scope of smblds."

**The smblds hook order** (`SMB:entrypoint.sh`, HEAD `84fe79e6`, unchanged since 2026-10-01):

1. When `/etc/samba/smb.conf` is absent, it runs `samba-tool domain provision`, then writes `server services`, `disable netbios`, `load printers` and the DNS forwarder line into `smb.conf` (`:36-54`).
2. `INSECURE_LDAP` sed (`:56-62`).
3. `INSECURE_PASSWORDSETTINGS` (`:64-73`).
4. It writes `/root/.ldaprc`, `/root/.ldappass` and `.ldapvirc` if missing (`:75-104`).
5. `for entrypoint in /entrypoint.d/*; do … if [ -x … ]; then … "${entrypoint}" else echo "Ignoring …, not executable"` (`:115-125`).
6. It starts Samba (`:127-136`).

So the `/entrypoint.d` scripts run on **every** container start, after provisioning and **before** Samba. `smb.conf` exists at that point and can be edited. The entrypoint's own sed lines are appended again on every start (issue #27, "duplicate entries"), so any `smb.conf` edit must be guarded with `grep -q`. Issue #16: scripts without the executable bit are skipped, and the reporter's only symptom was a Samba error later (`acl_read: Error retrieving instanceType`).

**osixia v2.** Hub description, TLS: "Set `OPENLDAP_BOOTSTRAP_TLS=true` to configure TLS during bootstrap. The default certificate paths are: `/container/services/openldap/assets/certs/cert.crt`, `…/cert.key`, `…/ca.crt`". The variables `OPENLDAP_BOOTSTRAP_TLS_CERT`, `_TLS_CERT_KEY`, `_TLS_CA_CERT`, `_TLS_VERIFY_CLIENT` (default `allow`), `_TLS_PROTOCOL_MIN` (default `3.4`, i.e. TLS 1.3) and `_TLS_REQUIRED` (default `false`) go into `olcTLS*` (`OSX:services/openldap-bootstrap/assets/ldif/config/tls/01-global-tls.ldif.template`). Listeners come from `OPENLDAP_URLS`, default `ldap://:3890 ldaps://:6360 ldapi:///`, so StartTLS and plain run on 3890 and LDAPS on 6360. slapd runs as uid 911 (`OSX:Dockerfile:35`), so the key must be readable by that uid; a git checkout's 0644 is. authentik mounts its generated certs at the default folder with custom names and `OPENLDAP_BOOTSTRAP_TLS_VERIFY_CLIENT: try` (`AK:tests/e2e/test_source_ldap_sasl_external.py:138-185`).

**vegardit.** `LDAP_TLS_ENABLED=auto` "activate[s] TLS only if the files referenced by `LDAP_TLS_CERT_FILE` and `LDAP_TLS_KEY_FILE` satisfy the source requirements" (defaults `/run/secrets/ldap/server.crt|server.key`, CA `/run/secrets/ldap/ca.crt`). `LDAP_LDAPS_ENABLED=true` enables 636. `LDAP_TLS_SSF=128`: "A positive value rejects operations whose effective transport and authentication strength is lower, including ordinary clear-text connections" (`VG:README.md`, Transport Encryption).

### 1.2 Getting one CA and server cert for both servers: the three ways compared

| Way | Precedents (pinned) | Cost here | Problems |
| --- | --- | --- | --- |
| (a) Generate at test time in Node | **ldapts** (the hub's client): `node tests/data/generate-certs.mjs` as a CI step before `docker compose up` (`LT:.github/workflows/ci.yml:41-42`). It uses node-forge (`"node-forge": "1.4.0"`, `LT:package.json:76`), CA 730 days, server SAN `ldap.local`, `localhost` and no IP (`LT:tests/data/generate-certs.mjs:33-67`), output git-ignored (`LT:.gitignore:24`). **authentik** generates per test with Python `cryptography`: one-day validity, SAN `localhost` only (`AK:tests/e2e/test_source_ldap_sasl_external.py:33-125`). | A new devDependency (node-forge or @peculiar/x509). Node core cannot issue certificates: `crypto.X509Certificate` only parses. | Must run before the containers start, and the containers must be recreated whenever the CA changes. The harness reuses running containers (`e2e/global-setup.ts` comment), so a regenerated CA would not match a reused server and verification would fail. That forces "generate once if missing", which is (b) without the commit. |
| (b) Commit long-lived fixtures plus a regeneration script | **python-ldap** commits `ca.pem`, `server.pem`, `server.key`, `client.key` for "DNS Name `localhost` and IPs `127.0.0.1` and `:1`" (`PL:Lib/slapdtest/certs/README`). Its `gencerts.sh` (openssl CLI) signs with `-days 356300` and ends with `rm -rf $CATMPDIR ca.key`, so the CA key is discarded; the last real change was "Make tests pass after 2028" (2019-09-20). **Node.js core** commits `test/fixtures/keys/*-key.pem` with a `Makefile` of `openssl req -new -x509 -days 99999 …` (`NODE:test/fixtures/keys/Makefile:189,196`). **Go** commits a localhost test cert and key in source, "expiring at Jan 29 16:00:00 2084", generated with `--host 127.0.0.1,::1,example.com,…` (`GO:src/net/http/internal/testcert/testcert.go:10-13`). Go spells the key "RSA TESTING KEY" and swaps it back at run time (`:36,65`), because "Gerrit is complaining about pushes that affect these files … Hide the keys from this kind of scan by marking them explicitly as testing keys" (golang/go@02fe6ba958, 2019-05-21). | Nothing at run time. The owner regenerates with the host `openssl` (3.0.13 here) only if the files ever need to change. No new dependency, no image. | A test private key sits in git. See the scanning note below. The servers read PEM files directly, so Go's "TESTING KEY" disguise is not possible. |
| (c) openssl CLI in a pinned container at harness start | none found among the reference projects | One more image pull. **None of the three LDAP images has the `openssl` CLI**: smblds installs `samba-dc dropbear ldapvi ldb-tools openldap-clients py3-cryptography py3-setproctitle tini tzdata` (`SMB:Dockerfile:41`); osixia installs `openldap*` packages only (`OSX:Dockerfile:19-26`); vegardit installs `slapd slapd-contrib ldap-utils libsasl2-modules-gssapi-mit util-linux` (`VG:image/Dockerfile:53-58`). On Alpine v3.24 the `openssl` package is not required by `samba-dc`, `openldap*` or `py3-cryptography` (pkgs.alpinelinux.org "Required by", 32 entries). | The output must reach the host for `LDAP_CA_FILE`, so it is written by root into a bind mount, with ownership trouble on WSL. It needs the same recreate rule as (a), plus a `service_completed_successfully` init container (see §5). |

**Secret scanning.** GitHub's "Supported secret scanning patterns" (2026-10-10) lists `generic_private_key` ("`-----BEGIN PRIVATE KEY-----` header"), `rsa_private_key` and `ec_private_key` as **Generic** patterns. Its capabilities table (parsed from the page HTML) says that for generic patterns User alerts are "Supported", "Push protection (default)" is "Not supported" and "Push protection (configurable)" is "Supported". "About alerts": "For GitHub to scan for generic patterns and AI-detected secrets, you must first enable the features for your repository or organization", and such alerts "can have a higher rate of false positives or secrets used in tests". This repository (`gh api repos/LovingCivilian/dify-app-hub`, 2026-10-10) is `public` with `secret_scanning: enabled`, `secret_scanning_push_protection: enabled` and `secret_scanning_non_provider_patterns: disabled`. A committed test key is therefore neither blocked at push nor alerted today. If the owner later enables generic patterns, one alert appears and can be closed as used in tests. The key never reaches the image: `.dockerignore` excludes `e2e/`.

**Recommendation: (b).** It is the only option that needs nothing at test time and cannot drift from a reused container. Two well-known LDAP-adjacent projects use the same pattern (python-ldap for exactly `localhost`/`127.0.0.1`/`::1`, and Node core). It adds no dependency and no pull. Throwing the CA key away (python-ldap) means nobody can mint more certificates under this test CA. Commands follow openssl-req(1) 3.0: "-CA … implies use of -x509", "-addext … This option can be given multiple times", and the "Generate a self-signed root certificate" example. Sign the server certificate with `openssl x509 -req -CA … -extfile`, so that only the listed extensions are applied: `-extensions` defaults to the unnamed section of `-extfile`, per `openssl x509 -help`. Ubuntu's default `x509_extensions = v3_ca` would otherwise make the server certificate a CA. Use RSA 2048, because smb.conf(5) speaks of "the RSA certificate" and "the RSA private key". The script is in §7.1.

**Node TLS facts used above.** tls.md: "`servername` … must be a host name, and not an IP address"; `checkServerIdentity` checks "the server's host name (or the provided `servername` when explicitly set)"; `tls.checkServerIdentity(hostname, cert)`: "The host name or IP address to verify the certificate against". DEP0123 (deprecations.md, v24.x): "Type: Runtime. Setting the TLS ServerName to an IP address is not permitted by RFC 6066." Node sends SNI only when `servername` is set (`N24:lib/internal/tls/wrap.js:1790-1800`).

**Not confirmed.** That GnuTLS (Samba) loads the PKCS#8 `BEGIN PRIVATE KEY` that OpenSSL 3 writes; GnuTLS reads PKCS#8, but this was not run. That `openssl verify -verify_ip` passes for the generated pair; the script checks it.

---

## 2. smblds seeding

**Verdict.** Pin `smblds/smblds:latest@sha256:b4eeb4e723a3b3284101b950f9ab8c0e36665303ce962e86ef0b4e83f7677641`. The same digest is on `quay.io/smblds/smblds:latest` (Quay API, "Fri, 09 Oct 2026 14:19:24"). The image was created 2026-10-09T14:18:05Z on `alpine-minirootfs-3.24.2` (amd64 config blob), and Alpine v3.24's `samba-dc` is `4.23.8-r0` (pkgs.alpinelinux.org, 2026-10-10). The image is rebuilt daily, so the `563ba62d…` digest in `e2e-ldap-server.md` is already stale; bump it on purpose. Seed with two executable scripts in `/entrypoint.d`, guarded by a marker. Use the default secure LDAP; plain simple binds stay refused.

**Environment** (`SMB:entrypoint.sh:21-26`; Hub description "Environment Variables"):

| Variable                    | Default and meaning                                               |
| --------------------------- | ----------------------------------------------------------------- |
| `REALM`                     | default `SAMDOM.EXAMPLE.COM` (uppercased)                         |
| `DOMAIN`                    | default `SAMDOM`, non-alphanumerics stripped, first 15 characters |
| `ADMINPASS`                 | default `Passw0rd`, must meet complexity                          |
| `INSECURE_LDAP`             | `false`; true appends `ldap server require strong auth = no`      |
| `INSECURE_PASSWORDSETTINGS` | `false`; true turns off complexity, length and age                |
| `SERVER_SERVICES`           | default `ldap cldap`; the Hub says CLDAP is "usually not needed"  |
| `SSH_AUTHORIZED_KEYS`       | enables SSH access                                                |
| `TZ`                        | default `UTC`                                                     |
| `DEBUG`                     | not documented; turns on `set -x`                                 |

`REALM`, `DOMAIN`, `ADMINPASS` and `SERVER_SERVICES` take effect only at provisioning (inside `if [ ! -f /etc/samba/smb.conf ]`).

**The `/entrypoint.d` contract.** Executable files only, run in shell-glob order (sorted), on every start, as root, before Samba. Hub: "any executable file is run before the start of the Samba daemon" and "`/entrypoint.d` might be handy for customization scripts that contain e.g. `samba-tool user create`". A running server is not available in this phase. Issue #5 (2023): "customization scripts … run before Samba starts, but that means one can't use e.g. `ldapmodify`". The maintainer added `ldb-tools` for direct database edits and said post-start hooks would need "reworking of the current concept". `samba-tool` without `-H` works on the local database, so it runs fine here.

**Provisioning at every start?** Provisioning happens when `/etc/samba/smb.conf` is missing. With the image's anonymous volumes, a new container gets new volumes and provisions again. A `docker compose up` that recreates the container keeps the volumes ("picks up the changes by stopping and recreating the containers (preserving mounted volumes)", compose up reference), so it does not provision again. With tmpfs mounts (§7.2), every container start provisions again, because tmpfs content is lost when the container stops. The image declares `VOLUME ["/entrypoint.d/", "/etc/dropbear/", "/etc/samba/", "/root/", "/var/cache/samba/", "/var/lib/samba/", "/var/log/samba/"]` (`SMB:Dockerfile:63`; the image config blob confirms the same seven paths). Alpine puts only `/etc/samba/smb.conf` in those paths (pkgs contents search), and the image deletes it (`Dockerfile:42`), so empty tmpfs mounts hide nothing. Docker's tmpfs defaults are read-write with exec allowed, "the default maximum size … is 50% of the host's total RAM", "`tmpfs-mode` … Defaults to `1777`", and tmpfs usage "counts against the container's memory cgroup limit (`--memory` / Compose `mem_limit`)" (docs.docker.com/engine/storage/tmpfs).

**Can a plain domain user read users, groups, `memberOf` and `objectGUID`?** Yes, through Pre-Windows 2000 Compatible Access. Microsoft Learn ("Active Directory security groups"): "Members of the Pre–Windows 2000 Compatible Access group have Read access for all users and groups in the domain." Its default member is "[Authenticated Users]" "If you choose the Windows 2000-only permissions mode". Samba provisions the same: `dn: CN=Pre-Windows 2000 Compatible Access,CN=Builtin,${DOMAINDN}`, "description: A backward compatibility group which allows read access on all users and groups in the domain", `member: CN=S-1-5-11,CN=ForeignSecurityPrincipals,${DOMAINDN}` (S-1-5-11 = Authenticated Users) (`SAM:source4/setup/provision_users.ldif:311-320`). The `user` class's own default SD gives `AU` read control and read on four property sets only, (`A;;RC;;;AU`)(`OA;;RP;59ba2f42-…;;AU`)… (`SAM:source4/setup/ad-schema/MS-AD_Schema_2K8_R2_Classes.txt`, cn: User). Read access to `userAccountControl` and `memberOf` therefore comes from the inherited Pre-Windows 2000 grant, which a hardened AD may have changed. That belongs in the owner's live check and in `docs/ldap.md`.

**samba-tool syntax** (samba-tool(8), "complete for version 4.23.0", samba.org/samba/docs/4.23/man-html/samba-tool.8.html). The man page lists the commands. The `user add` options come from the source, because the man page does not list them.

| Purpose | Command | Notes |
| --- | --- | --- |
| Add a user | `samba-tool user add username [password]` ("Add a new user to the Active Directory Domain.") | Options (`SAM:python/samba/netcmd/user/add.py:78-118`): `--given-name`, `--surname`, `--initials`, `--mail-address`, `--description`, `--use-username-as-cn`, `--userou`, `--random-password`, `--must-change-at-next-login`. CN = given name + surname (the display name), or the username if both are missing. `userPrincipalName` = `user@dnsdomain` (`SAM:python/samba/samdb.py`, see `e2e-ldap-server.md` §3.1). |
| Disable a user | `samba-tool user disable username` ("Disable a user account."); `user enable` reverses it | Sets `UF_ACCOUNTDISABLE`. |
| Rename (objectGUID test) | `samba-tool user rename username [--surname] [--given-name] [--initials] [--force-new-cn=NEW_CN] [--reset-cn] [--display-name] [--mail-address] [--samaccountname] [--upn]` ("Rename a user and related attributes … The user's CN will be renamed automatically.") |  |
| Groups | `samba-tool group add groupname`; `samba-tool group addmembers groupname members` | `addmembers` takes `--object-types`, default `user,group,computer` (`SAM:python/samba/netcmd/group.py:437-444`), so a group can be a member of a group: nesting. `group rename` has `--force-new-cn` too. |

**A DN with a comma or other special characters.** `samba-tool user add` builds the DN as a string without escaping (`samdb.py`, `e2e-ldap-server.md` §3.1). `user rename` takes `--force-new-cn` as given and builds `ldb.Dn(samdb, "CN=%s" % new_user_cn)` with the old parent (`SAM:python/samba/netcmd/user/rename.py:159-177`); `group rename` does the same (`group.py:1363`). The caller escapes the value the RFC 4514 way, and one documented option gives a comma DN: `samba-tool user rename frank --force-new-cn='Smith\, Frank'` gives `CN=Smith\, Frank,CN=Users,…`. A group CN with `(`, `)`, `&` and a comma exercises the hub's RFC 4515 filter escaping of `{group_dn}`. The alternative is an `ldbadd` LDIF (the image wraps `ldbadd` with `LDB_MODULES_PATH`, `SMB:Dockerfile:55-58`), but an LDAP-created user still needs `samba-tool user setpassword` and `user enable`.

**Password rules.** Complexity stays on (`INSECURE_PASSWORDSETTINGS` off). Seed passwords use three character classes and contain neither an account name nor a name part. The scripts are in §7.3.

**Not confirmed.** The exact result code and diagnostic for a disabled account's bind (AD sends 49 with `data 533`). Whether provisioning succeeds on tmpfs: smblds patches out `smbd.set_nt_acl` (`SMB:Dockerfile:43-48`), which is the xattr path that needs privileges, so it is expected to; the pre-flight checks it. Whether a rename via `--force-new-cn` with a backslash produces the expected DN (source inference). How long provisioning takes.

---

## 3. A healthcheck that proves LDAP is ready

**Verdict.** On both servers: bind as the seeded service account over TLS, verifying the committed CA. This proves at once that the listener is up, that our certificate is the one being served (with SAN `localhost`), and that the seed has run. Samba's seed runs before Samba starts; osixia's bootstrap runs before slapd. Use `ldapwhoami`; Samba implements the WhoAmI extended operation (`LDB_EXTENDED_WHOAMI_OID`, `ldapsrv_whoami`, `SAM:source4/ldap_server/ldap_extended.c:159-207`).

- **smblds.** The image wraps `ldapsearch` and friends as `HOME='/root' exec /usr/bin/<bin> -x -y /root/.ldappass "$@"` (`SMB:Dockerfile:49-52`). `/root/.ldaprc` holds `URI ldaps://localhost`, `TLS_REQCERT never`, `BASE …` and `BINDDN CN=Administrator,CN=Users,…` (`entrypoint.sh:76-83`). The wrapper's forced `-y` conflicts with a service-account password and `TLS_REQCERT never` skips verification, so the check calls `/usr/bin/ldapwhoami` directly with `LDAPTLS_CACERT` and `LDAPTLS_REQCERT=demand`. ldap.conf(5) reads "user files $HOME/ldaprc, $HOME/.ldaprc, ./ldaprc" and then "variables $LDAP<uppercase option name>"; "Settings late in the list override earlier ones" (`OL26:doc/man/man5/ldap.conf.5:53-58`), so the environment beats `.ldaprc`. The built-in check (§0 item 3) is not usable.
- **osixia.** authentik's check is `ldapsearch -x -H ldap://localhost:3890 -b "" -s base`, an anonymous Root DSE read (`AK:…sasl_external.py:142-157`). The stronger form is `ldapwhoami -x -ZZ -H ldap://localhost:3890 -D <service DN> -w …` with the same two variables (`-ZZ`: StartTLS must succeed).
- **vegardit.** Its entrypoint waits with `ldapwhoami -Q -Y EXTERNAL -H ldapi:///` (`VG:image/run.sh:298`). The same service-account bind works as an external check.

**Timing** (Dockerfile reference, HEALTHCHECK): "**start period** provides initialization time for containers that need time to bootstrap. Probe failure during that period will not be counted towards the maximum number of retries. However, if a health check succeeds during the start period, the container is considered started". "During the **start period**, health checks run at **start interval** frequency instead". In Compose, "`interval`, `timeout`, `start_period`, and `start_interval` … Introduced in Docker Compose version 2.20.2" (compose services reference). Suggested values: smblds `start_period: 180s`, `start_interval: 2s` (provisioning time unknown); osixia `start_period: 60s`, `start_interval: 1s`; both `interval: 10s`, `timeout: 5s`, `retries: 3`. Add `--wait-timeout 300` to `up --wait` so a hang fails ("Maximum duration in seconds to wait for the project to be running|healthy").

**Not confirmed.** The `HOME` of uid 911 in osixia. Irrelevant, because every option is passed explicitly.

---

## 4. The generic server: osixia v2 alpha or vegardit

**Verdict: osixia/openldap:2.6.15-alpha**, pinned `@sha256:de37b295c8f11f6654a2376f7b5f9d5e9d028bd2f50713751f99ed270f7abbec` (Hub, 2026-10-07, unchanged; OpenLDAP `2.6.15-r0`). It is configured through its documented environment switches plus two documented `config/custom` fragments. Its seed LDIF **carries `memberOf` explicitly** (item 4 below). vegardit (`vegardit/openldap:2.6.10@sha256:a6ef0b528b889880a861c44995c5d6c91a972216f1a878857689aa9789ee24d6`, Debian `slapd 2.6.10+dfsg-1`) remains the non-alpha fallback, at the cost of a harness post-start `ldapmodify` for every cn=config change.

### 4.1 osixia v2 facts

1. **Environment** (Hub description; `OSX:environment/.env*`):
   - Suffix and root DN: `OPENLDAP_BOOTSTRAP_SUFFIX`, `OPENLDAP_BOOTSTRAP_DATA_ROOT_DN` (default `cn=admin,${SUFFIX}`), `OPENLDAP_BOOTSTRAP_DATA_ROOT_PASSWORD_HASHED` and `…CONFIG_ROOT_PASSWORD_HASHED`. These are "generated if empty" and printed in the logs. A given value is used verbatim (`ensure_hashed_password` returns early when set, `OSX:…/scripts/helpers/password.sh`), and slapd-config(5) allows `olcRootPW: <password>` as "a password (or hash of the password)" (`OL26:doc/man/man5/slapd-config.5:1816-1817`).
   - The read-only account: `OPENLDAP_BOOTSTRAP_DATA_READONLY=true`, `…_READONLY_DN` (its `cn=` is parsed with a lowercase `cn=` regex, `scripts/20-database-readonly.sh`) and `…_READONLY_PASSWORD_HASHED`.
   - Modules: `OPENLDAP_BOOTSTRAP_MODULES`, default `back_mdb.so argon2.so refint.so ppolicy.so unique.so memberof.so syncprov.so`.
   - Overlays: `OPENLDAP_BOOTSTRAP_MEMBEROF=true` (groupOfNames/member/memberOf), `OPENLDAP_BOOTSTRAP_PPOLICY=true` with `…PPOLICY_DEFAULT_*` (`MAX_FAILURE` default 5, `LOCKOUT` default true).
   - TLS: §1.1. Limits: `OPENLDAP_BOOTSTRAP_GLOBAL_SIZE_LIMIT=500`. Open files: `OPENLDAP_NOFILE=65536`.
2. **LDIF folders.** The README says custom folders `…/ldif/config/custom` ("Configuration (`cn=config`): ACLs, indexes, overlays, and other settings") and `…/ldif/data/custom` ("Initial directory entries"). "Bootstrap imports the assembled entries with `slapadd`. Use entry attributes, without modification instructions such as `changetype: modify`." Files are grouped by tens: "Files in the same ten-group … are concatenated without a blank line" and "a fragment in the same ten-group can add attributes to an existing entry; a different group starts a new entry" (`OSX:services/openldap-bootstrap/assets/ldif/README.md`). "Bootstrap runs only when both configuration and data directories are empty." The image declares no `VOLUME`, so a new container starts clean.
3. **Default ACLs.** These matter for the service account (`config/base/65-database-acl.ldif.template`, `69-database-acl-close.ldif`). Users get read on `cn,sn,givenName,mail,uid` only, and the list ends with `to * by * none`. A plain service account could not read `entryUUID`, `memberOf` or `displayName`. The read-only switch adds `olcAccess: to * by dn.exact="${…READONLY_DN}" read by * break` and denies it `userPassword` (`database-readonly/66-database-readonly-acl.ldif.template`), so **the read-only account is the documented service account**. A simple bind needs only "`auth` (=x) privileges on the attribute the credentials are stored in (usually `userPassword`)" (`OL26:doc/man/man5/slapd.access.5`, OPERATION REQUIREMENTS), which `by anonymous auth` grants.
4. **slapadd and overlays.** Bootstrap loads config and data offline (`startup.sh:91-113`). An overlay's `BackendInfo` starts as `oi->oi_bi = *be->bd_info` and replaces only `bi_db_*`, `bi_op_*`, `bi_extended`, `bi_operational`/`chk_*`, `bi_entry_*`, `bi_access_allowed` and `bi_acl_*` (`OL26:servers/slapd/backover.c:1375-1425`). The `bi_tool_*` functions that slapadd uses go straight to the backend. **memberof therefore never runs for seeded entries.** slapo-memberof(5): "Any time a group entry is modified, its members are modified". Two documented consequences follow. (i) Write `memberOf` in the seed LDIF; slapadd accepts it, because `NO-USER-MODIFICATION` is enforced in the protocol add path (`slap_mods_no_user_mod_check`, `OL26:servers/slapd/add.c:306`), which slapadd does not use. The OpenLDAP Admin Guide recommends exactly this for bulk loads ("slapadd(8) should be used to bulk load entries known to be valid", `admin26-guide.txt:8808`). (ii) Or seed online with `ldapadd`; the osixia README documents `docker run --rm … osixia/openldap run -- ldapadd -H ldap://… -f /tmp/entries.ldif`. A one-shot seed service blocks `up --wait` unless a dependent declares `service_completed_successfully` (§5). Online changes during tests (ldapts adding a member) are maintained by the overlay.
5. **Forced paging.** Admin Guide §9.3.1.2: "If the LDAP client adds the pagedResultsControl … the hard size limit is used by default … the size limit applies to the total count of entries returned within the search, and not to a single page." "`size.prtotal` … `unlimited` removes the limit on the number of entries that can be returned by a paged search." §9.4 covers per-database `olcLimits` with `dn.exact="…"`, and §9.5.4 gives the example `limits users size.soft=5 size.hard=100 size.prtotal=disabled`. Source: an unpaged request with a limit above `size.hard` is clamped, not refused, because `#undef ABOVE_HARD_LIMIT_IS_ERROR` (`OL26:servers/slapd/limits.c:29,1299-1316`). An unpaged request without a limit gets the soft limit and so returns 5 entries plus sizeLimitExceeded (4). Requesting a page above `size.pr` is refused (`:1168-1177`), so `size.pr` is left unset. The fragment `config/custom/62-e2e-limits.ldif` holds only `olcLimits: …` lines; it is a 6x file, so it joins the `olcDatabase=mdb` entry built by `60-database.ldif.template`. Keep at most 5 groups (the hub's group search sends `sizeLimit: 20`, clamped to 5) and 9 users that match the filter.
6. **Nested groups.** Alpine v3.24's `openldap` package ships `/usr/lib/openldap/nestgroup.so`, and `/etc/openldap/schema/dyngroup.ldif` exists (pkgs contents search). The module is not a switch: add `nestgroup.so` to `OPENLDAP_BOOTSTRAP_MODULES` and an overlay entry in `config/custom/170-e2e-nestgroup.ldif` (group 17, so its own entry). The configuration is objectClass `olcNestGroupConfig` (SUP `olcOverlayConfig`) with `olcNestGroupBase` (DN, multi-valued) and `olcNestGroupFlags`, one flag per value ("Please insert multiple names as separate … values"); the flags are `member-values`, `member-filter`, `memberof-values` and `memberof-filter` (`OL26:servers/slapd/overlays/nestgroup.c:41-54,184-192,213-245`). With `memberof-filter`, `(memberOf=G)` is rewritten into an OR over G and its child groups (`:524-570`). Child groups are G's `member` values that lie under a `nestgroup-base` (`nestgroup_get_childDNs`, `:488-520`), so **groups need their own subtree** (`ou=groups`) and users need stored `memberOf` for their direct groups. The man page says the member attribute "must be DN-valued", but the code also accepts NameAndOptionalUID (`:149-161`). slapo-dynlist's `member+memberOf@groupOfNames*` would also work, but its man page warns: "Filtering on dynamic groups may return incomplete results if the search operation uses the pagedResults control" (BUGS). The sync pages, so nestgroup is the choice.
7. **Disabled marker.** slapo-ppolicy(5): "If pwdAccountLockedTime is set to 000001010000Z, the user's account has been permanently locked … Note that account locking only takes effect when the pwdLockout password policy attribute is set to 'TRUE'" (default true). Set `OPENLDAP_BOOTSTRAP_PPOLICY_DEFAULT_MAX_FAILURE=0`; per the man page, "If pwdMaxFailure is not present, or its value is zero (0), then a user will be allowed to continue to attempt to authenticate … no matter how many consecutive failed bind attempts". Otherwise five wrong-password tests would lock a test user for 900 s. `pwdAccountLockedTime` is defined by the ppolicy module, which is loaded, and slapadd accepts it.
8. **Passwords.** Admin Guide §14.4: "RFC4519 specifies that passwords are not stored in encrypted (or hashed) form … This is also the most interoperable storage scheme." Plain `userPassword` values in the seed LDIF are documented, and slapadd stores them unchanged. ppolicy's hash-cleartext acts only on online modifies.
9. **Entry UUIDs.** slapadd adds `entryUUID` when missing (`OL26:servers/slapd/slapadd.c:246-252`), so the seed omits it. It is new on every bootstrap.

### 4.2 vegardit facts (the fallback)

- Data LDIF goes in online: "The image processes each file with `ldapmodify -a`", and "Use this directory for entries below the configured organization DN. Do not use it to change `cn=config`, add schemas, or load modules." `/opt/ldifs/custom-schema/` is for "dynamic-configuration schema LDIFs … Modules and overlays need separate configuration" (README, "Supported initialization mounts"). Root-DN access to `cn=config` is allowed by `LDAP_INIT_ALLOW_CONFIG_ACCESS='true'` (README), which a post-start harness `ldapmodify` would need for `olcLimits` and the nestgroup overlay. The OpenLDAP Admin Guide documents run-time cn=config changes via `ldapmodify`.
- The memberof overlay is loaded by default but set to `olcMemberOfGroupOC: groupOfUniqueNames`, `olcMemberOfMemberAD: uniqueMember` (`VG:image/ldifs/init_module_memberof.ldif`). The ACLs end with `{4}to * … by users read`, so any bound user reads everything (`init_mdb_acls.ldif`).
- Debian trixie `slapd 2.6.10+dfsg-1` ships `/usr/lib/ldap/nestgroup.so`, without a `.la` (packages.debian.org file list, 2026-10-10). This closes the open point in `e2e-ldap-server.md` §7.
- `VOLUME ["/etc/ldap/slapd.d", "/var/lib/ldap"]` (`VG:image/Dockerfile:174`), so it needs `down -v` or tmpfs. `LDAP_TLS_SSF=128` blocks plain binds unless it is set to 0. `LDAP_NOFILE_LIMIT=1024` is the default.

**Why osixia.** Every cn=config need (service account ACL, `olcLimits`, the nestgroup overlay, memberof, ppolicy, TLS) goes through a documented osixia mechanism. On vegardit the same needs require an undocumented hook or a harness step. osixia's one cost, explicit `memberOf` in the seed, is a few lines and is the bulk-load form the Admin Guide describes. It is alpha, but authentik pins `osixia/openldap:2.6.10-alpha` by digest the same way.

**Not confirmed** (pre-flight):

- slapadd's acceptance of `memberOf` and `pwdAccountLockedTime` in the data LDIF (source inference).
- That nestgroup's `memberof-filter` returns complete results under paging; nestgroup's man page has no BUGS note, unlike dynlist's.
- The attribute order inside the joined 6x config entry; `62-` sits between `olcDbIndex` and `olcAccess`, so ACL order is unaffected.
- Whether osixia's `container envsubst templates` writes into the custom folders when they hold no templates. Mount single files read-only, as authentik does.

---

## 5. Harness integration

**Verdict.**

- **Playwright.** In `e2e/global-setup.ts`, run `docker compose -f docker-compose.e2e.yml up -d --wait --wait-timeout 300 mysql ldap-ad`, then the existing migrations. Profiles doc: "When you explicitly target a service on the command line that has one or more profiles assigned, you do not need to enable the profile manually as Compose runs that service regardless of whether its profile is activated". OpenLDAP is therefore not started for Playwright. `--profile ldap up -d --wait` would start both LDAP servers and MySQL ("Services without a `profiles` attribute are always enabled").
- **`pnpm test:ldap`.** A Vitest project named `ldap` (Vitest 4.1.6 `test.projects`; inline projects with `extends: true` to inherit the root options) with its own `globalSetup` that runs `docker compose -f docker-compose.e2e.yml up -d --wait --wait-timeout 300 ldap-ad ldap-openldap`, plus `mysql` and the migrations only if the suite writes through the real DAL. The scripts become `"test": "vitest run --project unit"` and `"test:ldap": "vitest run --project ldap"`; the docs show "`pnpm run test --project e2e`". Vitest: "The global setup runs before test workers are created and only if tests are queued" and "Global setup only runs if there is at least one test queued", so `pnpm test` never starts containers. A returned function is the teardown ("runs after all test files finish").

**Ordering.** Playwright starts the webServers before `globalSetup` (`playwright.config.ts` comment). `next dev` does not touch LDAP at boot under spec §6.4: `register()` starts the schedule, and the startup catch-up run, only "when the `LDAP_*` block is set and `LDAP_SYNC_SCHEDULE` is not `off`"; `.env.e2e` sets `off`. The first LDAP connection is a sign-in, a Sync now or a group search, all after `globalSetup`. `LDAP_CA_FILE` is read at connect time, and with committed fixtures the file always exists anyway.

**Why not other Compose mechanisms.** A one-shot seed or cert service under `--wait` is waited for as "running or healthy" unless another service depends on it with `condition: service_completed_successfully`. The source comment says otherwise "--wait will never finish waiting for one-shot containers" (`docker/compose:pkg/compose/start.go`, `getDependencyCondition`, via Context7 `/docker/compose`). `post_start` hooks do not fit seeding either: "there's no set time for when exactly they will execute … no ordering guarantee between the hook and the container's entrypoint" (docs.docker.com/compose/how-tos/lifecycle, "Requires: Docker Compose 2.30.0").

**Stopping and resetting.**

- `docker compose down` removes "Containers for services defined in the Compose file" and networks. "Anonymous volumes are not removed by default. However, as they don't have a stable name, they are not automatically mounted by a subsequent `up`." `-v, --volumes` removes "named volumes declared in the "volumes" section of the Compose file and anonymous volumes attached to containers" (compose down reference).
- To stop only the LDAP services: "if you only want to stop the `phpmyadmin` service, you can run `docker compose down phpmyadmin`" (profiles doc). So `docker compose -f docker-compose.e2e.yml down -v ldap-ad ldap-openldap`. `docker compose -f docker-compose.e2e.yml --profile ldap down -v` resets everything; per the docs it "stop[s] and remove[s] services with the `debug` profile and services without a profile". A plain `down` does not stop profile services.
- `-V, --renew-anon-volumes` ("Recreate anonymous volumes instead of retrieving data from the previous containers") and `--force-recreate` give a fresh smblds without tmpfs.

**State rule.** The e2e MySQL is reused across runs. A Samba that is provisioned again issues new `objectGUID`s, and an osixia bootstrap new `entryUUID`s. B3b specs must therefore start by deleting `users` rows with `source = 'ldap'`, their directory memberships and the directory group links (`e2e/fixtures/db.ts`). Then a fresh or reused directory always works. Tests that change directory state (disable, rename) restore it in `finally`, through `docker compose exec -T ldap-ad samba-tool user enable bob` and similar, or through ldapts as Administrator.

**`.env.e2e`.** Set every `LDAP_*` key, including the optional `LDAP_SYNC_TIMEZONE`. Next loads `.env` files from the repository root without overriding variables already in `process.env`, so an `LDAP_*` key missing from `.env.e2e` would leak in from the owner's `.env` during e2e runs. Avoid `$` and `#` in values.

**Not confirmed.** Docker's statement that a tmpfs mount on a `VOLUME` path suppresses the anonymous volume. Expected, because the path is then a mount; the pre-flight checks `docker volume ls --filter dangling=true` before and after.

---

## 6. Memory

**Verdict.** Neither project documents a memory figure (`e2e-ldap-server.md` §7). The only documented slapd number is the open-files effect. moby/moby#8231 (2014) reports slapd at "700M" in a container against "only around 2M" on a VM, with `ch_calloc of 1048576 elems of 704 bytes failed`: slapd sizes a table by the open-files limit. vegardit's README cites that issue for its `LDAP_NOFILE_LIMIT=1024` default. osixia sets `ulimit -n "${OPENLDAP_NOFILE}"`, default 65536 (`OSX:services/openldap/process.sh`), which is about 44 MiB at 704 bytes per entry, so set `OPENLDAP_NOFILE=1024` in the test. Samba's memory depends on its process model. samba(8): "prefork — The default. A process is started for each Samba service, and a fixed number of worker processes are started for those services that support it (currently LDAP, NETLOGON, and KDC)", "controlled by the smb.conf(5) parameter prefork children, which defaults to 4". smblds runs `samba --interactive` without `-M` (`entrypoint.sh:130`), so it is prefork with 4 LDAP workers. `prefork children = 1` (smb.conf(5), "This should be set to a small multiple of the number of CPU's") is a documented way to cut that; one LDAP worker still serves many connections. With tmpfs, the Samba databases count against `mem_limit` (Docker tmpfs docs).

**Proposal for the pre-flight to verify.**

1. Start both servers without `mem_limit`.
2. Sample `docker stats --no-stream --format '{{.Name}} {{.MemUsage}}'` every 2 s during provisioning and seeding, once when healthy and idle, and once after the `pnpm test:ldap` suite. Measure with and without `prefork children = 1`.
3. Then set `mem_limit` to about twice the peak, rounded up. Starting guesses: **`ldap-ad: 512m`** and **`ldap-openldap: 128m`** (with `OPENLDAP_NOFILE=1024`).
4. Afterwards confirm `docker inspect -f '{{.State.OOMKilled}}'` is `false`, and time `up --wait` for each service.

Compose: "`mem_limit` configures a limit on the amount of memory a container can allocate … must be consistent with the `limits.memory` attribute in the Deploy Specification" (compose services reference).

---

## 7. Proposed configuration (UNTESTED: written to be copied by the plan and run once by the pre-flight)

Layout (all new, under `e2e/fixtures/ldap/`):

```
e2e/fixtures/ldap/
  tls/generate.sh            (100755) regenerates the three files below; CA key discarded
  tls/ca.crt  tls/server.crt  tls/server.key   (committed; .crt/.key because .gitignore ignores *.pem)
  ad/entrypoint.d/10-tls.sh  (100755)
  ad/entrypoint.d/20-seed.sh (100755)
  openldap/config/62-e2e-limits.ldif
  openldap/config/170-e2e-nestgroup.ldif
  openldap/data/70-e2e-tree.ldif
  openldap/data/80-e2e-people.ldif
  openldap/data/90-e2e-groups.ldif
```

Optional: a `.gitattributes` with `*.sh text eol=lf` and `*.ldif text eol=lf`, so a Windows checkout cannot break the scripts. The repository has no `.gitattributes`. lint-staged formats only js/ts/css/json/html/yml/md (`.lintstagedrc.mjs`), so oxfmt will format the Compose YAML but leave these files alone.

### 7.1 `e2e/fixtures/ldap/tls/generate.sh`

```sh
#!/bin/sh
# Regenerates the e2e/test:ldap TLS fixtures: a test CA (its key is discarded, as python-ldap's
# Lib/slapdtest/certs/gencerts.sh does) and one server certificate for both test directories.
# Test-only: .dockerignore keeps e2e/ out of the image. Needs the openssl CLI (3.0 or later).
set -eu
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cat >"$tmp/ca.cnf" <<'EOF'
[req]
distinguished_name = dn
prompt = no
x509_extensions = v3_ca
[dn]
CN = dify-app-hub e2e LDAP test CA
[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
EOF

cat >"$tmp/server.cnf" <<'EOF'
[req]
distinguished_name = dn
prompt = no
[dn]
CN = localhost
EOF

cat >"$tmp/server.ext" <<'EOF'
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
subjectAltName = DNS:localhost,IP:127.0.0.1,IP:::1,DNS:ldap-ad,DNS:ldap-openldap
EOF

openssl req -x509 -config "$tmp/ca.cnf" -newkey rsa:2048 -noenc -sha256 -days 36500 \
  -keyout "$tmp/ca.key" -out ca.crt
openssl req -new -config "$tmp/server.cnf" -newkey rsa:2048 -noenc -sha256 \
  -keyout server.key -out "$tmp/server.csr"
openssl x509 -req -in "$tmp/server.csr" -CA ca.crt -CAkey "$tmp/ca.key" -set_serial 2 \
  -days 36500 -sha256 -extfile "$tmp/server.ext" -out server.crt
# 0644 on purpose: osixia's slapd runs as uid 911 and must read the key; the Samba seed copies it to 0600 root.
chmod 0644 ca.crt server.crt server.key
openssl verify -CAfile ca.crt -verify_hostname localhost server.crt
openssl verify -CAfile ca.crt -verify_ip 127.0.0.1 server.crt
```

### 7.2 `docker-compose.e2e.yml` additions

```yaml
# B3b test directories (ADR-0010 harness; spec §8). Not started by a plain `up`: the e2e and test:ldap
# global setups target them by name. Reset: docker compose -f docker-compose.e2e.yml down -v ldap-ad ldap-openldap
ldap-ad:
  # Samba AD LDAP for developers/CI; rebuilt daily from alpine:latest, so bump the digest on purpose.
  image: smblds/smblds:latest@sha256:b4eeb4e723a3b3284101b950f9ab8c0e36665303ce962e86ef0b4e83f7677641
  container_name: dify-app-hub-e2e-ldap-ad
  profiles: [ldap]
  hostname: dc
  environment:
    REALM: E2E.HUB.TEST
    DOMAIN: E2EHUB
    ADMINPASS: E2e-Adm-Passw0rd
    SERVER_SERVICES: ldap
    TZ: UTC
  ports:
    - '127.0.0.1:10636:636' # LDAPS
    - '127.0.0.1:10389:389' # StartTLS; plain simple binds refused (ldap server require strong auth = yes)
  volumes:
    - ./e2e/fixtures/ldap/ad/entrypoint.d:/entrypoint.d:ro
    - ./e2e/fixtures/ldap/tls:/e2e-tls:ro
  tmpfs: # the image's VOLUME paths; fresh domain per container, nothing left behind (fallback: drop and use down -v)
    - /etc/samba:mode=0755
    - /var/lib/samba:mode=0755
    - /var/cache/samba:mode=0755
    - /var/log/samba:mode=0755
    - /root:mode=0700
    - /etc/dropbear:mode=0700
  mem_limit: 512m # placeholder until the pre-flight measures it
  healthcheck:
    test:
      - CMD
      - env
      - LDAPTLS_CACERT=/e2e-tls/ca.crt
      - LDAPTLS_REQCERT=demand
      - /usr/bin/ldapwhoami
      - -x
      - -H
      - ldaps://localhost
      - -D
      - CN=svc-hub,CN=Users,DC=e2e,DC=hub,DC=test
      - -w
      - E2e-Svc-Passw0rd
    interval: 10s
    timeout: 5s
    retries: 3
    start_period: 180s
    start_interval: 2s

ldap-openldap:
  # OpenLDAP 2.6.15 (osixia v2 alpha); bootstrap on an empty container (no VOLUME), data loaded by slapadd.
  image: osixia/openldap:2.6.15-alpha@sha256:de37b295c8f11f6654a2376f7b5f9d5e9d028bd2f50713751f99ed270f7abbec
  container_name: dify-app-hub-e2e-ldap-openldap
  profiles: [ldap]
  hostname: ldap-openldap
  environment:
    OPENLDAP_BOOTSTRAP_ORGANIZATION: E2E Hub
    OPENLDAP_BOOTSTRAP_SUFFIX: dc=openldap,dc=hub,dc=test
    OPENLDAP_BOOTSTRAP_CONFIG_ROOT_PASSWORD_HASHED: E2e-Cfg-Passw0rd # used verbatim; plain is allowed (slapd-config(5) olcRootPW)
    OPENLDAP_BOOTSTRAP_DATA_ROOT_PASSWORD_HASHED: E2e-Adm-Passw0rd
    OPENLDAP_BOOTSTRAP_DATA_READONLY: 'true'
    OPENLDAP_BOOTSTRAP_DATA_READONLY_DN: cn=svc-hub,dc=openldap,dc=hub,dc=test
    OPENLDAP_BOOTSTRAP_DATA_READONLY_PASSWORD_HASHED: E2e-Svc-Passw0rd
    OPENLDAP_BOOTSTRAP_MODULES: back_mdb.so argon2.so refint.so ppolicy.so unique.so memberof.so syncprov.so nestgroup.so
    OPENLDAP_BOOTSTRAP_MEMBEROF: 'true'
    OPENLDAP_BOOTSTRAP_PPOLICY: 'true'
    OPENLDAP_BOOTSTRAP_PPOLICY_DEFAULT_MAX_FAILURE: '0' # no lockout from wrong-password tests; pwdLockout stays TRUE
    OPENLDAP_BOOTSTRAP_TLS: 'true'
    OPENLDAP_BOOTSTRAP_TLS_CERT: /e2e-tls/server.crt
    OPENLDAP_BOOTSTRAP_TLS_CERT_KEY: /e2e-tls/server.key
    OPENLDAP_BOOTSTRAP_TLS_CA_CERT: /e2e-tls/ca.crt
    OPENLDAP_NOFILE: '1024'
  ports:
    - '127.0.0.1:13890:3890' # plain (none) and StartTLS
    - '127.0.0.1:16360:6360' # LDAPS
  volumes:
    - ./e2e/fixtures/ldap/tls:/e2e-tls:ro
    - ./e2e/fixtures/ldap/openldap/config/62-e2e-limits.ldif:/container/services/openldap-bootstrap/assets/ldif/config/custom/62-e2e-limits.ldif:ro
    - ./e2e/fixtures/ldap/openldap/config/170-e2e-nestgroup.ldif:/container/services/openldap-bootstrap/assets/ldif/config/custom/170-e2e-nestgroup.ldif:ro
    - ./e2e/fixtures/ldap/openldap/data/70-e2e-tree.ldif:/container/services/openldap-bootstrap/assets/ldif/data/custom/70-e2e-tree.ldif:ro
    - ./e2e/fixtures/ldap/openldap/data/80-e2e-people.ldif:/container/services/openldap-bootstrap/assets/ldif/data/custom/80-e2e-people.ldif:ro
    - ./e2e/fixtures/ldap/openldap/data/90-e2e-groups.ldif:/container/services/openldap-bootstrap/assets/ldif/data/custom/90-e2e-groups.ldif:ro
  mem_limit: 128m # placeholder until the pre-flight measures it
  healthcheck:
    test:
      - CMD
      - env
      - LDAPTLS_CACERT=/e2e-tls/ca.crt
      - LDAPTLS_REQCERT=demand
      - ldapwhoami
      - -x
      - -ZZ
      - -H
      - ldap://localhost:3890
      - -D
      - cn=svc-hub,dc=openldap,dc=hub,dc=test
      - -w
      - E2e-Svc-Passw0rd
    interval: 10s
    timeout: 5s
    retries: 3
    start_period: 60s
    start_interval: 1s
```

### 7.3 Samba scripts (`e2e/fixtures/ldap/ad/entrypoint.d/`, both mode 100755 in git)

`10-tls.sh`:

```sh
#!/bin/sh
# smblds runs every executable /entrypoint.d/* on every start, after provisioning and before samba starts.
# Samba refuses a TLS key not owned by its euid with mode exactly 0600 (CVE-2013-4476 check in
# source4/lib/tls/tls_tstream.c), so the key is copied in, never bind-mounted at the target path.
set -eu
tls_dir=/var/lib/samba/private/tls
mkdir -p "$tls_dir"
install -m 0600 -o root -g root /e2e-tls/server.key "$tls_dir/e2e-key.pem"
install -m 0644 -o root -g root /e2e-tls/server.crt "$tls_dir/e2e-cert.pem"
install -m 0644 -o root -g root /e2e-tls/ca.crt "$tls_dir/e2e-ca.pem"
# Same sed construct as the image's entrypoint.sh; guarded because this script runs on every start (issue #27).
if ! grep -q 'tls certfile = tls/e2e-cert.pem' /etc/samba/smb.conf; then
  sed -e '/^\[global\]/a\\ttls enabled = yes\n\ttls keyfile = tls/e2e-key.pem\n\ttls certfile = tls/e2e-cert.pem\n\ttls cafile = tls/e2e-ca.pem' \
      -i /etc/samba/smb.conf
fi
# Optional memory saver to compare in the pre-flight (smb.conf(5) "prefork children", default 4):
# grep -q 'prefork children' /etc/samba/smb.conf || sed -e '/^\[global\]/a\\tprefork children = 1' -i /etc/samba/smb.conf
```

`20-seed.sh`:

```sh
#!/bin/sh
# Seeds the AD-like test directory offline (samba-tool on the local sam.ldb; samba is not running yet).
# DNs: CN=<Given Surname>,CN=Users,DC=e2e,DC=hub,DC=test (svc-hub: CN=svc-hub,…).
set -eu
marker=/var/lib/samba/.e2e-seeded
[ -f "$marker" ] && exit 0
pw='E2e-Dir-Passw0rd'

samba-tool user add svc-hub 'E2e-Svc-Passw0rd' --description='dify-app-hub read-only service account'
samba-tool user add alice "$pw" --given-name=Alice --surname=Admin --mail-address=alice@e2e.hub.test
samba-tool user add bob "$pw" --given-name=Bob --surname=Builder --mail-address=bob@e2e.hub.test
samba-tool user add carol "$pw" --given-name=Carol --surname=Gone --mail-address=carol@e2e.hub.test
samba-tool user disable carol                                   # userAccountControl bit 2
samba-tool user add dave "$pw" --given-name=Dave --surname=Nomail # no mail: refused at first sign-in
samba-tool user add erin "$pw" --given-name=Erin --surname=Rename --mail-address=erin@e2e.hub.test # rename test
samba-tool user add frank "$pw" --given-name=Frank --surname=Smith --mail-address=frank@e2e.hub.test
samba-tool user rename frank --force-new-cn='Smith\, Frank'     # DN CN=Smith\, Frank,CN=Users,…

samba-tool group add hub-admins
samba-tool group add hub-engineering
samba-tool group add hub-backend
samba-tool group add rnd-team
samba-tool group rename rnd-team --force-new-cn='R&D (Berlin)\, Team' # ( ) \ in a filter value: RFC 4515 escaping
samba-tool group addmembers hub-admins alice
samba-tool group addmembers hub-engineering hub-backend         # nesting: in-chain rule 1.2.840.113556.1.4.1941
samba-tool group addmembers hub-backend bob
samba-tool group addmembers rnd-team frank

touch "$marker"
```

Run-time helpers for the specs (documented commands; the test restores what it changes): `docker compose -f docker-compose.e2e.yml exec -T ldap-ad samba-tool user disable bob` / `… user enable bob`; `… user rename erin --samaccountname=erin2 --surname=Renamed` and back (same `objectGUID`, new DN and login).

### 7.4 OpenLDAP LDIF (`e2e/fixtures/ldap/openldap/`)

`config/62-e2e-limits.ldif` (no `dn:`; the 6x group joins it to the `olcDatabase=mdb` entry):

```ldif
olcLimits: dn.exact="cn=svc-hub,dc=openldap,dc=hub,dc=test" size.soft=5 size.hard=5 size.prtotal=unlimited
```

`config/170-e2e-nestgroup.ldif`:

```ldif
dn: olcOverlay=nestgroup,olcDatabase={1}mdb,cn=config
objectClass: olcOverlayConfig
objectClass: olcNestGroupConfig
olcOverlay: nestgroup
olcNestGroupBase: ou=groups,dc=openldap,dc=hub,dc=test
olcNestGroupFlags: memberof-filter
```

`data/70-e2e-tree.ldif`:

```ldif
dn: ou=people,dc=openldap,dc=hub,dc=test
objectClass: organizationalUnit
ou: people

dn: ou=groups,dc=openldap,dc=hub,dc=test
objectClass: organizationalUnit
ou: groups
```

`data/80-e2e-people.ldif`. There are 10 users; 9 match `(&(objectClass=inetOrgPerson)(!(pwdAccountLockedTime=*)))`, more than the service account's limit of 5. `memberOf` is written explicitly because slapadd bypasses the memberof overlay (§4.1 item 4); it must match the groups' `member` values in `90-`.

```ldif
dn: uid=alice,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: alice
cn: Alice Admin
givenName: Alice
sn: Admin
displayName: Alice Admin
mail: alice@openldap.hub.test
userPassword: E2e-Dir-Passw0rd
memberOf: cn=hub-admins,ou=groups,dc=openldap,dc=hub,dc=test

dn: uid=bob,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: bob
cn: Bob Builder
givenName: Bob
sn: Builder
displayName: Bob Builder
mail: bob@openldap.hub.test
userPassword: E2e-Dir-Passw0rd
memberOf: cn=hub-backend,ou=groups,dc=openldap,dc=hub,dc=test

dn: uid=carol,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: carol
cn: Carol Gone
sn: Gone
displayName: Carol Gone
mail: carol@openldap.hub.test
userPassword: E2e-Dir-Passw0rd
pwdAccountLockedTime: 000001010000Z

dn: uid=dave,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: dave
cn: Dave Nomail
sn: Nomail
displayName: Dave Nomail
userPassword: E2e-Dir-Passw0rd

dn: uid=erin,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: erin
cn: Erin Rename
sn: Rename
displayName: Erin Rename
mail: erin@openldap.hub.test
userPassword: E2e-Dir-Passw0rd

dn: uid=frank,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: frank
cn: Smith, Frank
sn: Smith
displayName: Smith, Frank
mail: frank@openldap.hub.test
userPassword: E2e-Dir-Passw0rd
memberOf: cn=R&D (Berlin)\, Team,ou=groups,dc=openldap,dc=hub,dc=test

dn: uid=user01,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: user01
cn: User 01
sn: 01
mail: user01@openldap.hub.test

dn: uid=user02,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: user02
cn: User 02
sn: 02
mail: user02@openldap.hub.test

dn: uid=user03,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: user03
cn: User 03
sn: 03
mail: user03@openldap.hub.test

dn: uid=user04,ou=people,dc=openldap,dc=hub,dc=test
objectClass: inetOrgPerson
uid: user04
cn: User 04
sn: 04
mail: user04@openldap.hub.test
```

`data/90-e2e-groups.ldif` (4 groups, at most 5, so the clamped `sizeLimit: 20` of the hub's group search still works):

```ldif
dn: cn=hub-admins,ou=groups,dc=openldap,dc=hub,dc=test
objectClass: groupOfNames
cn: hub-admins
member: uid=alice,ou=people,dc=openldap,dc=hub,dc=test

dn: cn=hub-engineering,ou=groups,dc=openldap,dc=hub,dc=test
objectClass: groupOfNames
cn: hub-engineering
member: cn=hub-backend,ou=groups,dc=openldap,dc=hub,dc=test

dn: cn=hub-backend,ou=groups,dc=openldap,dc=hub,dc=test
objectClass: groupOfNames
cn: hub-backend
member: uid=bob,ou=people,dc=openldap,dc=hub,dc=test
memberOf: cn=hub-engineering,ou=groups,dc=openldap,dc=hub,dc=test

dn: cn=R&D (Berlin)\, Team,ou=groups,dc=openldap,dc=hub,dc=test
objectClass: groupOfNames
cn: R&D (Berlin), Team
member: uid=frank,ou=people,dc=openldap,dc=hub,dc=test
```

### 7.5 `.env.e2e` block (Playwright, smblds over LDAPS)

```dotenv
LDAP_URL=ldaps://127.0.0.1:10636
LDAP_ENCRYPTION=ldaps
LDAP_CA_FILE=e2e/fixtures/ldap/tls/ca.crt
LDAP_BIND_DN=CN=svc-hub,CN=Users,DC=e2e,DC=hub,DC=test
LDAP_BIND_PASSWORD=E2e-Svc-Passw0rd
LDAP_USER_BASE_DN=CN=Users,DC=e2e,DC=hub,DC=test
LDAP_USER_FILTER=(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))
LDAP_LOGIN_ATTRIBUTE=sAMAccountName
LDAP_ID_ATTRIBUTE=objectGUID
LDAP_EMAIL_ATTRIBUTE=mail
LDAP_NAME_ATTRIBUTE=displayName
LDAP_GROUP_BASE_DN=CN=Users,DC=e2e,DC=hub,DC=test
LDAP_GROUP_FILTER=(objectClass=group)
LDAP_GROUP_NAME_ATTRIBUTE=cn
LDAP_GROUP_MEMBER_FILTER=(memberOf:1.2.840.113556.1.4.1941:={group_dn})
LDAP_SYNC_SCHEDULE=off
LDAP_SYNC_TIMEZONE=UTC
```

The users base is `CN=Users` rather than the domain root on purpose. A domain-root search may return continuation references to `DomainDnsZones`/`ForestDnsZones`; whether smblds returns them like AD is open (`e2e-ldap-server.md` §6). One `test:ldap` case should search at `DC=e2e,DC=hub,DC=test` to surface that behaviour.

OpenLDAP settings for `test:ldap` (built in the test, not in `.env.e2e`):

| Setting | Value |
| --- | --- |
| URL | `ldap://127.0.0.1:13890` (`starttls`, `none`); `ldaps://127.0.0.1:16360` optional |
| Bind DN | `cn=svc-hub,dc=openldap,dc=hub,dc=test` |
| User base | `ou=people,dc=openldap,dc=hub,dc=test` |
| User filter | `(&(objectClass=inetOrgPerson)(!(pwdAccountLockedTime=*)))` |
| Login, id, email, name | `uid`, `entryUUID`, `mail`, `displayName` |
| Group base | `ou=groups,dc=openldap,dc=hub,dc=test` |
| Group filter, name | `(objectClass=groupOfNames)`, `cn` |
| Member filter | `(memberOf={group_dn})` |

### 7.6 Pre-flight checklist (one run; then `down -v`)

1. `sh e2e/fixtures/ldap/tls/generate.sh`, then `openssl x509 -in e2e/fixtures/ldap/tls/server.crt -noout -ext subjectAltName`.
2. `docker volume ls -q --filter dangling=true > tmp/ldap-dangling-before.txt`, then `time docker compose -f docker-compose.e2e.yml up -d --wait --wait-timeout 300 ldap-ad ldap-openldap`, then `docker compose -f docker-compose.e2e.yml ps`. Compare the dangling volumes before and after (tmpfs should leave none).
3. From the host:
   - `openssl s_client -connect 127.0.0.1:10636 -CAfile e2e/fixtures/ldap/tls/ca.crt -verify_ip 127.0.0.1 -verify_return_error -brief </dev/null` (Samba serves our cert);
   - `openssl s_client -starttls ldap -connect 127.0.0.1:13890 -CAfile e2e/fixtures/ldap/tls/ca.crt -verify_ip 127.0.0.1 -verify_return_error -brief </dev/null` (OpenLDAP StartTLS).
4. Samba. The image wrapper binds as Administrator: `docker compose -f docker-compose.e2e.yml exec -T ldap-ad ldapsearch -b 'CN=Users,DC=e2e,DC=hub,DC=test' '(sAMAccountName=frank)' dn objectGUID`. Expect `CN=Smith\, Frank,…`. Then `… '(member:1.2.840.113556.1.4.1941:=CN=Bob Builder,CN=Users,DC=e2e,DC=hub,DC=test)' cn`, which should list `hub-backend` and `hub-engineering`. A plain simple bind on 10389 should fail with strongerAuthRequired.
5. OpenLDAP:
   - `docker compose -f docker-compose.e2e.yml exec -T ldap-openldap ldapsearch -x -H ldap://localhost:3890 -D cn=svc-hub,dc=openldap,dc=hub,dc=test -w E2e-Svc-Passw0rd -b ou=people,dc=openldap,dc=hub,dc=test '(&(objectClass=inetOrgPerson)(!(pwdAccountLockedTime=*)))' dn` should return 5 entries and "Size limit exceeded (4)". The same with `-E pr=100/noprompt` should return 9.
   - `'(memberOf=cn=hub-engineering,ou=groups,dc=openldap,dc=hub,dc=test)'` should return bob (nestgroup).
   - `ldapwhoami -x -H ldap://localhost:3890 -D uid=carol,… -w E2e-Dir-Passw0rd` should fail with 49 (ppolicy lock).
   - `ldapsearch … entryUUID memberOf` on alice should show both attributes.
6. Memory and time per §6.
7. `docker compose -f docker-compose.e2e.yml down -v ldap-ad ldap-openldap`.

---

## 8. Pinned sources (all read 2026-10-10)

- Images:
  - `smblds/smblds:latest` index `sha256:b4eeb4e723a3b3284101b950f9ab8c0e36665303ce962e86ef0b4e83f7677641`: Hub, last updated 2026-10-09T14:19:07Z, amd64 manifest `sha256:b72edb88d43b5dec75a9e77bf09bfd22d9c250899eb83b270a2c165f5f504bcb`, config created 2026-10-09T14:18:05Z, base `alpine-minirootfs-3.24.2`, no SBOM; the same digest on `quay.io/smblds/smblds:latest`.
  - `osixia/openldap:2.6.15-alpha` `sha256:de37b295c8f11f6654a2376f7b5f9d5e9d028bd2f50713751f99ed270f7abbec` (2026-10-07; config: `User ldap`, entrypoint `/usr/sbin/container`, no `Volumes`, ports 3890/6360).
  - `vegardit/openldap:2.6.10` (= `2.6.x` = `latest`) `sha256:a6ef0b528b889880a861c44995c5d6c91a972216f1a878857689aa9789ee24d6` (2026-10-07; `Volumes` `/etc/ldap/slapd.d`, `/var/lib/ldap`).
- smblds/smblds-container@84fe79e6a032490de6eea630a5e8133eedf1353d: `entrypoint.sh`, `Dockerfile`, `healthcheck.sh`; issues #5, #11, #15, #16, #27, #29 with comments; Hub description (`tmp/b3-research/e2e-ldap/hub-smblds_smblds.md`).
- samba-team/samba@f28e9e6df8ae8fd6208804fb1440de5db35ba047:
  - `source4/lib/tls/tls_tstream.c:1572-1591`, `source4/lib/tls/tlscert.c:118-131`, `lib/util/util.c:143-180`;
  - `python/samba/netcmd/user/add.py:78-118`, `python/samba/netcmd/user/rename.py:159-177`, `python/samba/netcmd/group.py:437-444,1363`;
  - `source4/setup/provision_users.ldif:311-320`, `source4/setup/ad-schema/MS-AD_Schema_2K8_R2_Classes.txt` (User, Group `defaultSecurityDescriptor`), `source4/ldap_server/ldap_extended.c:159-207`.
- Samba docs: samba-tool(8) and samba(8) for 4.23 (samba.org/samba/docs/4.23/man-html/); smb.conf(5) (tls\*, `prefork children`, `additional dns hostnames`); wiki "Configuring LDAP over SSL (LDAPS) on a Samba AD DC".
- Packages:
  - Alpine v3.24: `samba-dc` 4.23.8-r0, `openldap` 2.6.15-r0 with `/usr/lib/openldap/nestgroup.so`, `/etc/openldap/schema/dyngroup.ldif`, `/etc/samba/smb.conf` (samba-common) as the only file under the Samba VOLUME paths, and `openssl` "Required by" (pkgs.alpinelinux.org); aports `openldap` APKBUILD `--with-tls=openssl`.
  - Debian trixie `slapd` 2.6.10+dfsg-1 file list (packages.debian.org).
- osixia/container-openldap@6e26809af9d9b6ac341b704e8e90730fa6e7bcb3:
  - `Dockerfile`, `README.md`, `services/openldap/process.sh`;
  - `services/openldap-bootstrap/startup.sh:9-113`, `assets/ldif/README.md`, `assets/scripts/{00-base,10-tls,20-database-readonly,50-ppolicy,70-memberof,90-custom}.sh`, `assets/scripts/helpers/{common,password}.sh`;
  - `assets/ldif/config/{base,tls,memberof,ppolicy,database-readonly}/*`.
- vegardit/docker-openldap@8331dc432030abcf30df0c47665f647e5f382e98: `image/Dockerfile`, `image/run.sh`, `image/tls.sh`, `image/ldifs/{init_module_memberof,init_mdb_acls}.ldif`, `README.md`.
- openldap/openldap@f46b74e75a9b79fec76655a9456ce643566d9558 (OPENLDAP_REL_ENG_2_6; the branch has since moved to be1aec9a):
  - `servers/slapd/backover.c:1375-1425`, `servers/slapd/slapadd.c:246-252,380-405`, `servers/slapd/add.c:306`, `servers/slapd/limits.c:29,1157-1316`, `servers/slapd/schema_check.c`;
  - `servers/slapd/overlays/nestgroup.c:41-54,140-245,470-640`, `servers/slapd/overlays/memberof.c:2259-2267`;
  - `doc/man/man8/slapadd.8`, `doc/man/man5/{slapd.access,ldap.conf,slapd-config}.5`;
  - OpenLDAP 2.6 Admin Guide (§9.3–9.5 Limits, §10, §14.4 Password Storage), slapo-memberof(5), slapo-dynlist(5), slapo-ppolicy(5) (saved in `tmp/b3-research/openldap/`), slapo-nestgroup(5).
- ldapts/ldapts@e670417788d7841dafd969d0597421db1950e656: `tests/data/generate-certs.mjs`, `.gitignore:24`, `.github/workflows/ci.yml:41-42`, `package.json:76`, `src/Client.ts:273-314,889-904`.
- Node.js:
  - nodejs/node@ae5a0f40b5787a369b6cde39c36fb2760a4cd309 `test/fixtures/keys/` (`Makefile`, `*-key.pem`);
  - nodejs/node v24.16.0 `lib/internal/tls/wrap.js:1661-1666,1790-1800`; `doc/api/deprecations.md` (v24.x) DEP0123; `doc/api/tls.md` (`servername`, `checkServerIdentity`; saved `tmp/b3-research/node22-tls.md`);
  - local run on Node v24.16.0 showing the DEP0123 warning.
- Committed test certs:
  - python-ldap/python-ldap@b47ed474a9bbf10ac7b8ce8253775d6197833e78 `Lib/slapdtest/certs/{README,gencerts.sh,ca.conf,server.key,server.pem,ca.pem}`;
  - golang/go@dfe2e7bfb454f71784ee1aeeac44063fd582f9f3 `src/net/http/internal/testcert/testcert.go:10-65` and commit 02fe6ba958 (2019-05-21);
  - goauthentik/authentik@c3f92b69 `tests/e2e/test_source_ldap_sasl_external.py:33-185`.
- GitHub: docs "Supported secret scanning patterns" (Generic patterns, Capabilities by category) and "About secret scanning alerts"; `gh api repos/LovingCivilian/dify-app-hub` `security_and_analysis`.
- Docker:
  - docs: Compose profiles, `docker compose up` and `down` references, lifecycle hooks, Compose services reference (`mem_limit`, `tmpfs`, healthcheck durations), Dockerfile reference HEALTHCHECK, tmpfs mounts;
  - docker/compose `pkg/compose/start.go` `getDependencyCondition` (Context7 `/docker/compose`);
  - moby/moby#8231.
- Vitest 4.1.6 docs (Context7 `/vitest-dev/vitest/v4.1.6`): `config/globalsetup.md`, `guide/lifecycle.md`, `guide/projects.md` (installed 4.1.7).
- Microsoft Learn "Active Directory security groups" (Pre–Windows 2000 Compatible Access).
- OpenSSL 3.0.13 `openssl-req(1)` (local man page), `openssl x509 -help`.
