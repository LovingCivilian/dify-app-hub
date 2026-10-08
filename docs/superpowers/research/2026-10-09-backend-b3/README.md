# Backend rework B3 research (groups, per-app access, LDAP)

Research for the B3 brainstorm of 2026-10-09, input to the spec `docs/superpowers/specs/2026-10-09-backend-b3-groups-access-ldap-design.md`. Each report was written by a research agent with sources pinned to a commit or quoted from a dated page (ADR-0002). Paths under `tmp/b3-research/` inside the reports point to local scratch (source clones, saved pages) that is not committed; the pinned commits in each report's sources section are the citable form.

| Report | Question |
| --- | --- |
| [ldap-client.md](ldap-client.md) | Which Node LDAP client (`ldapjs` decommissioned, `ldapts` 9.2.0 chosen), its documented API for B3, `objectGUID` and `entryUUID` string forms, Active Directory and OpenLDAP specifics, the risks to design around |
| [ldap-reference-projects.md](ldap-reference-projects.md) | How LibreChat, Open WebUI, Rocket.Chat, GitLab, Mattermost, Grafana, Keycloak and Nextcloud link, create, refresh, collide, deactivate, re-check and map directory accounts; next-auth's stance on linking by email |
| [groups-and-access.md](groups-and-access.md) | How Open WebUI, LibreChat, Dify, Grafana, Metabase and Langfuse model groups and per-resource access; OWASP Authorization and Next's Data Access Layer guidance |
| [periodic-jobs.md](periodic-jobs.md) | Running a periodic job for a self-hosted Next.js 16 app: the bundled docs, reference projects, MySQL claims, Docker patterns; details in [q2-worker-projects.md](q2-worker-projects.md) and [q2-cron-projects.md](q2-cron-projects.md) |
| [e2e-ldap-server.md](e2e-ldap-server.md) | Which throwaway LDAP servers the e2e and integration suites can run (`smblds/smblds` for AD behaviour, OpenLDAP 2.6 for the generic case) and what stays for the owner's live AD check |
| [nextauth-drizzle-antd.md](nextauth-drizzle-antd.md) | next-auth v4 with several Credentials providers and thrown codes, Drizzle 1.0.0-rc.3 foreign keys, `CHECK` and the drizzle-kit single-table cascade bug, MySQL 8.4 rules, antd `Tabs` versus `Segmented` |
