# Directory (LDAP) sign-in and sync

ADR-0029. People in the company directory sign in on the login page's "Directory account" tab with their directory username and password; they type the username without the domain (`jsmith`, not `CORP\jsmith` or `jsmith@corp.example.com`), as the tab's hint says. Their hub account is created at the first sign-in and linked to their entry by its key (`objectGUID` on Active Directory, `entryUUID` elsewhere), never by email. A scheduled sync, and Sync now on the users page, deactivate the accounts whose entry is gone or disabled, reactivate those that come back, refresh names and emails, and keep the members of hub groups linked to directory groups. Roles stay in the hub: a new directory account is a `user`, and the owner or an admin promotes it.

## Settings

Setting `LDAP_URL` turns the directory on; the keys marked required must then be set, or the first request fails with their names. The defaults are Active Directory's. Copy the block from `.env.template`.

| Variable | Required / default | Notes |
| --- | --- | --- |
| `LDAP_URL` | required | `ldaps://host:636` or `ldap://host:389` |
| `LDAP_ENCRYPTION` | required | `ldaps` (with `ldaps://`), `starttls` or `none` (with `ldap://`); case is ignored |
| `LDAP_CA_FILE` | optional | a PEM file with the CA that signed the directory's certificate, mounted into the container; Node's trust store otherwise. No setting skips certificate verification, and the hub verifies the directory's certificate even when the process runs with `NODE_TLS_REJECT_UNAUTHORIZED=0`. A file the hub cannot read is logged at start (see Logs) |
| `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD` | required | a read-only service account; a value with a `$` needs quoting (see below the table) |
| `LDAP_USER_BASE_DN` | required | where people are searched |
| `LDAP_USER_FILTER` | `(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))` | enabled AD users; a person the filter does not match cannot sign in and is deactivated by the sync |
| `LDAP_LOGIN_ATTRIBUTE` | `sAMAccountName` | what people type as their username |
| `LDAP_ID_ATTRIBUTE` | `objectGUID` | the link: `objectGUID`, `entryUUID` or a directory's own unique id. It must be unique and never change for an entry (a shared value makes the lookup answer "not found"); do not change the setting once accounts exist (the sync then stops with "ID attribute changed") |
| `LDAP_EMAIL_ATTRIBUTE`, `LDAP_NAME_ATTRIBUTE` | `mail`, `displayName` | an entry without an email cannot get an account |
| `LDAP_GROUP_BASE_DN` | `LDAP_USER_BASE_DN` | where the groups page searches directory groups |
| `LDAP_GROUP_FILTER`, `LDAP_GROUP_NAME_ATTRIBUTE` | `(objectClass=group)`, `cn` |  |
| `LDAP_GROUP_MEMBER_FILTER` | `(memberOf:1.2.840.113556.1.4.1941:={group_dn})` | `{group_dn}` is replaced by a linked group's DN; the default includes nested groups |
| `LDAP_SYNC_SCHEDULE` | `0 * * * *` | a five-field cron expression that fires (one that never does, such as `0 0 31 2 *`, is refused), or `off` |
| `LDAP_SYNC_TIMEZONE` | the hub process's local time zone (croner's default without a `timezone`; Node takes it from the `TZ` variable when set) | an IANA time zone name such as `Asia/Riyadh`; an offset such as `+01:00` is refused (write `Etc/GMT-1` or a city zone instead) |

A value with a `$` (a password, usually) needs care, because two programs read the files. Docker Compose reads `.env` for the container: write the value in single quotes, `LDAP_BIND_PASSWORD='pa$word'` (Docker docs, ".env file syntax": "Single-quoted (`'`) values are used literally"). For `pnpm dev`, Next reads `.env.development.local`, which overrides `.env`, and expands `$NAME` in it, so there the `$` is written `\$` ("If you need to use variable with a `$` in the actual value, it needs to be escaped e.g. `\$`", Next's environment-variables guide).

Every filter must be wrapped in parentheses and parse as an LDAP filter; attribute settings must be attribute names (descriptors such as `mail`; a numeric OID is refused, since ldapts cannot read one in a filter). The hub writes the values people type (and the directory's own values) into its filters escaped. ldapts' parser closes a filter that misses only its last `)` after an `&`, `|` or `!` (`(&(objectClass=user)` is sent as `(&(objectClass=user))`), so check the parentheses by eye.

## Active Directory

```dotenv
LDAP_URL=ldaps://dc01.corp.example:636
LDAP_ENCRYPTION=ldaps
LDAP_CA_FILE=/run/secrets/corp-root-ca.pem
LDAP_BIND_DN=CN=svc-hub,OU=Service Accounts,DC=corp,DC=example
LDAP_BIND_PASSWORD=…
LDAP_USER_BASE_DN=OU=Staff,DC=corp,DC=example
```

- **The service account** needs read access to the people and groups under the two base DNs, including `objectGUID`, `userAccountControl`, `mail`, `displayName` and `memberOf`. A plain domain user has it in a default domain, through "Pre-Windows 2000 Compatible Access" (Microsoft Learn, "Active Directory security groups"); a hardened domain may have removed that, and the service account then needs an explicit read grant. It needs no write right.
- **Nested groups** are resolved by the default member filter (`LDAP_MATCHING_RULE_IN_CHAIN`); Microsoft notes that such queries "may be more processor intensive" on large group trees.
- **Disabled accounts** are left out by the default user filter, so a person disabled in AD cannot sign in and is deactivated at the next sync.

## OpenLDAP and other LDAPv3 servers

```dotenv
LDAP_URL=ldap://ldap.corp.example:389
LDAP_ENCRYPTION=starttls
LDAP_BIND_DN=cn=svc-hub,dc=corp,dc=example
LDAP_BIND_PASSWORD=…
LDAP_USER_BASE_DN=ou=people,dc=corp,dc=example
LDAP_USER_FILTER=(&(objectClass=inetOrgPerson)(!(pwdAccountLockedTime=*)))
LDAP_LOGIN_ATTRIBUTE=uid
LDAP_ID_ATTRIBUTE=entryUUID
LDAP_GROUP_BASE_DN=ou=groups,dc=corp,dc=example
LDAP_GROUP_FILTER=(objectClass=groupOfNames)
LDAP_GROUP_MEMBER_FILTER=(memberOf={group_dn})
```

`memberOf` exists only with the memberof overlay; nested groups need the nestgroup overlay with `memberof-filter` (OpenLDAP 2.6.8 and later). Without them, write a member filter for your server. An Active Directory filter on another server matches nothing without an error: the sync then stops with "no entries" and changes nothing.

## Encryption, and moving off `none`

`LDAP_ENCRYPTION=none` sends every person's directory password, and the service account's, in clear between the hub and the directory (RFC 4513 §5.1.3: a simple bind with a password "is not suitable for authentication in environments without confidentiality protection"). The hub logs a warning at start and the users page shows "Unencrypted connection". It also stops working when the domain controller requires LDAP signing: a new Windows Server 2025 domain does by default, and so does a domain controller upgraded to 2025 that had no signing policy (Microsoft Learn, "LDAP signing for Active Directory Domain Services"). Sign-ins then say "The directory is unreachable" and the log names result code 8 (`StrongAuthRequiredError`).

To move to `ldaps`:

1. The domain controller needs a certificate for Server Authentication whose subject or DNS name is the DC's fully qualified name; installing it is enough ("There's no user interface for configuring LDAPS", Microsoft Learn).
2. Set `LDAP_URL=ldaps://<the DC's FQDN>:636` and `LDAP_ENCRYPTION=ldaps`. A URL by IP address works only if the certificate also names that IP.
3. Mount the enterprise root CA into the hub container and point `LDAP_CA_FILE` at it.
4. If the container cannot resolve the DC's name, map it with Compose's `extra_hosts` (`- "dc01.corp.example=10.0.0.5"`).

Channel binding does not apply to simple binds over TLS (Microsoft Learn, "LDAP channel binding for AD DS").

The hub always verifies the directory's certificate against the host name in `LDAP_URL`. A mismatch is logged with Node's own message, which names the configured host and the names in the certificate (no secret); fix the URL or the certificate, never the verification.

## The sync

- **When:** at `LDAP_SYNC_SCHEDULE` in `LDAP_SYNC_TIMEZONE`, once at start when a due run was missed, and on Sync now. Several hub containers run each scheduled time once. No run starts while another has been going for less than 30 minutes; a run that died with its container shows "Did not finish". In a zone with daylight saving, a time that falls in the skipped hour runs an hour later (croner 10.0.1: 02:30 in `Europe/Berlin` on 2026-03-29 runs at 03:30), and the default hourly schedule runs once in that hour. Sync now waits for its run: a front proxy whose read timeout is shorter than a long run cuts the answer, the run still finishes, and the panel shows it after a reload.
- **What:** the people the user filter matches are compared with the hub's directory accounts by key. Absent → deactivated and signed out at their next request; back → reactivated; present → name, email and username refreshed (an email another account has is kept and counted as a conflict). People without a hub account are ignored: accounts are created at first sign-in. Each hub group linked to directory groups gets the hub accounts found in any of them as its directory members; members added by hand stay. A linked group the directory refuses keeps its members and counts as a group error. A group base or filter that holds none of the linked groups is not a stop: every link turns "not found" and loses its directory members, and the groups page shows them missing.
- **Safety stops** (nothing changes, the run says why): the directory did not answer, refused the service account or a search ("failed"); it returned no entries ("no entries": check the base DN and the filter); an account was linked with another `LDAP_ID_ATTRIBUTE` ("ID attribute changed": put the old value back).
- **History:** the users page shows the last run, its counts, the next run and Sync now; runs are kept 90 days.
- **Admin and directory deactivation** are separate: the directory never lifts an admin's deactivation, and an admin's Reactivate does not undo the directory's.

## Logs

Each refused sign-in logs one line, `authorizeDirectory: sign-in refused` with the username and a reason: `unknown_user`, `ambiguous_user`, `wrong_password`, `invalid_entry` (no valid key), `entry_without_email`, `email_in_use`, `account_inactive` (deactivated by an admin), `directory_off`, and `invalid_input` (the form body was refused, with no input value logged; the local tab logs it too). The local tab logs `directory_account` when someone tries a directory account's email there. A failure of the directory logs its error class and LDAP result code, never a password or the directory's own message. The person is told "The directory is unreachable" when the directory does not answer, refuses the service account or StartTLS, or answers their bind with result code 8 (signing or TLS required), 13 (confidentiality required), 51 (busy) or 52 (unavailable) (a 51 or 52 at any step of the sign-in counts); only 49 is a wrong password, and that answer is the same generic message as an unknown username. Do not run the hub with `NODE_DEBUG=ldapts`: ldapts then logs every request it sends (`util.debuglog`), with the bind DN and the search filter, the typed username included; it redacts only the password. Each sync logs one `directorySync: run finished` line with the outcome, the error code and the counts. With `ldaps` or `starttls`, an `LDAP_CA_FILE` the hub cannot read (a wrong path, a file the container cannot open) refuses every directory sign-in and sync; it is logged once at start, with the schedule on or off, and again at each attempt, by the setting and the error code, never the path: `directorySchedule: { name: 'DirectoryConfigError', setting: 'LDAP_CA_FILE', cause: { code: 'ENOENT' } }` (`ENOENT` no such file, `EACCES` no read permission, `EISDIR` a directory). The sign-in then says "Something went wrong while logging in" and the run "an internal error (see the server log)".

## Checking a new directory

1. From the hub's container, the directory's port answers (TCP only):

   ```bash
   docker compose exec -T app node -e "const s=require('node:net').connect({host:process.argv[1],port:Number(process.argv[2]),timeout:5000});s.on('connect',()=>{console.log('open');s.destroy()}).on('timeout',()=>{console.log('timeout');s.destroy()}).on('error',e=>console.log('error',e.code))" <DC address> 389
   ```

2. Start with `LDAP_SYNC_SCHEDULE=off`, sign in as yourself on the Directory tab, and check your account on the users page (Directory, your username, the user role).
3. Run Sync now: the counts should be plausible (no mass deactivation).
4. Link a hub group to a directory group, grant it an app, and sign in as a member of a nested group.
5. Then set the schedule.

## Known limits

- Sign-in attempts are not throttled yet, and every failed directory sign-in counts toward the directory's lockout policy.
- A local account cannot be switched to directory sign-in yet; the person keeps both or an admin resolves it.
- Changing `LDAP_ID_ATTRIBUTE` after accounts exist is not supported.
- Forgot and reset password are for local accounts; a directory account's password is the directory's.
- With SMTP on, the inherited forgot-password handler can still mail a link to a directory account's email. The link's reset fails, because the database refuses a password on a directory account (MySQL error 3819 on the `users_source_credentials` check); the form shows its existing failure message.
- Each refused directory attempt for a known username costs one service-account search plus two per distinct linked group, counted before the person's bind: input for the throttling design.
