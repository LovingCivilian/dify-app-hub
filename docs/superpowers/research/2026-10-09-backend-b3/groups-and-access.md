# Groups and per-resource access: how well-known projects do it

Research for B3 (groups and per-app access, later LDAP). Collected on 2026-10-09. The sources are official docs plus source code at pinned commits (listed at the end). Citations use `repo@sha:path:line`, shortened to `repo:path:line` after the first use of each repo; the full SHA is in "Pinned sources". Local copies of every downloaded page and file are under `tmp/b3-research/src/` (git-ignored, never executed):

- the sparse clones are `open-webui/`, `librechat/`, `dify/` and `grafana/`;
- the pages are in `*-docs/`, `metabase/`, `owasp/` and `langfuse-pages/`;
- every `.ts` and `.tsx` file in the clones was renamed to `.ts.txt` or `.tsx.txt`, because the root tsconfig includes `**/*.ts`.

Projects covered: Open WebUI, LibreChat, Dify (Community and Enterprise), Grafana, Metabase, Langfuse.

---

## 1. Open WebUI

Open WebUI is the closest analogue to the hub. Its model list is filtered per user, and it has admin-configured resources that have no owner.

**1. Data model.**

- Groups live in a `group` table (`id, user_id, name, description, data, meta, permissions JSON, …`). Membership lives in `group_member (id, group_id FK → group.id ON DELETE CASCADE, user_id)` (`open-webui/open-webui@8bd8b4f:backend/open_webui/models/groups.py:37-86`).
- Grants have been a normalized table since February 2026. It replaced the older `access_control` JSON column (migration `f1e2d3c4b5a6_add_access_grant_table.py:1-12`, "Migrates from JSON access_control columns to normalized access_grant table").
  - Shape: `access_grant (id, resource_type, resource_id, principal_type 'user'|'group'|'anyone', principal_id (user id, group id or '*'), permission 'read'|'write', created_at)`, with a unique constraint over all five (`backend/open_webui/models/access_grants.py:25-45`).
- **There is no built-in "everyone" group.** "Public" is the wildcard grant `user:*:read`, meaning every signed-in user. A separate `anyone:*:read` grant opts a resource into access without an account (`access_grants.py:14-17, 219-231`). Docs: "**Public** is stored as one more grant: read access for every signed-in user" (`open-webui/docs@81b07ae:docs/features/authentication-access/rbac/groups.md:90`).
- The old JSON semantics, kept in the conversion code: "None → public read (user:\* read) — except files which are private; {} → private/owner-only (no grants)" (`access_grants.py:83-96`).

**2. Semantics.**

- **New workspace items** (models, knowledge, prompts, tools, skills) are private to the creator. The editors start with `accessGrants = []` (`src/lib/components/workspace/Models/ModelEditor.svelte:131`). Docs: "Private with no grants means only the owner can see and use the item" (`groups.md:84`).
- **Admin-configured resources** (tool servers, MCP servers, arena models) have no owner. For them, "Private with no grants means admin-only: every admin can see and use the resource, and no regular user can, until you grant a group or a user" (`groups.md:86`).
- **Provider models never configured in the DB** are shown to admins only: "No DB entry means no access control configured yet; only admins can see unconfigured models" (`backend/open_webui/utils/models.py:572-573`).
- **Admin bypass is configurable.** `BYPASS_ADMIN_ACCESS_CONTROL` defaults to True (`backend/open_webui/config.py:2086-2092`).
  - The docs say the flag gates only list and selector surfaces. "Per-id direct-access endpoints … are **intentionally not gated** by this flag" (`docs/reference/env-configuration.mdx:540-548`).
  - `BYPASS_MODEL_ACCESS_CONTROL` (default False) opens every model to everyone (`env-configuration.mdx:806-810`).
- **Principals:** a single user, a group, or the wildcard.
- **Levels:** read ("view and use") and write ("Owner-equivalent … update or delete it, and manage its access list") (`groups.md:110`).
- **Union semantics:** "Open WebUI permissions are **additive** (Union-based)… 'Deny' permissions do not exist" (`groups.md:12-16`).

**3. Enforcement.**

- **List:** `get_filtered_models` batch-fetches the ids the user may read through `AccessGrants.get_accessible_resource_ids(...)`, which is one query over user, `user:*` and group grants (`utils/models.py:524-547`, `models/access_grants.py:622-676`). Knowledge, prompts and the other resource types filter their list query with `has_permission_filter`, a correlated EXISTS subquery on `access_grant` (`access_grants.py:723-820`).
- **Direct access:** `check_model_access` checks owner OR `AccessGrants.has_access(...)` and raises "Model not found" otherwise (`utils/models.py:465-521`). The chat completion path calls it unless a bypass applies (`backend/open_webui/main.py:1150`).
- **Shared rules:** the list and direct paths are different methods on the same `AccessGrantsTable`, built from the same principal conditions (public, user, group ids). They are not literally one function.

**4. Group sources.**

- **Sources:** local groups, OAuth/OIDC groups claim (`ENABLE_OAUTH_GROUP_MANAGEMENT`, optional JIT creation), LDAP `memberOf` (`ENABLE_LDAP_GROUP_MANAGEMENT`), and a trusted header.
- **Groups are matched by name.** LDAP takes the CN out of each group DN (`backend/open_webui/routers/auths.py:591-631`). `sync_groups_by_group_names` looks groups up with `Group.name.in_(group_names)` (`models/groups.py:516-572`).
- **Strict sync, and local groups are included:**
  - The docs say users "will be **removed** from any Open WebUI groups (including those manually created or assigned within Open WebUI) if those groups are **not** present in their OAuth claims… An absent or empty groups claim leaves memberships untouched" (`docs/features/authentication-access/auth/sso/index.mdx:299-305`).
  - "There is no role exemption" (`:312`).
  - Changes apply at the next login (`:320`).
  - The LDAP path calls the same `sync_groups_by_group_names` (`routers/auths.py:693-697`).
- **Escape hatch:** `OAUTH_BLOCKED_GROUPS` names groups that the OAuth sync never adds or removes (`utils/oauth.py:1730-1745`).

**5. Admin UI.**

- **Grants:** edited on the resource, in the "Access" modal (`src/lib/components/workspace/common/AccessControl.svelte`). The docs describe the "Add Access" picker and an access list with Read/Write per row (`groups.md:72-74`).
- **Group pages:** these edit members and feature permissions, not grants.
- **Audit:** admin-only, read-only "Preview Access" views per user and per group (`GET /api/v1/users/{id}/preview`, `GET /api/v1/groups/id/{id}/preview`) "resolve every access grant for a specific user or group" (`groups.md:114-125`).

**6. Removal and cascade.**

- **Deleting a resource** calls `AccessGrants.revoke_all_access(type, id)`, for example `models/models.py:578` and `models/knowledge.py:801`.
- **Deleting a group** removes the group row. Memberships cascade by FK (`groups.py:79-82, 435-442`). No code was found that deletes `access_grant` rows naming the group (see Not confirmed).
- **Deleting a user** removes them from groups and deletes their chats (`models/users.py:847-861`). No grant cleanup was found.

## 2. LibreChat

**1. Data model.**

- Grants are a generic ACL collection, `AclEntry` (`danny-avila/LibreChat@e1dfc10:packages/data-schemas/src/schema/aclEntry.ts:6-89`):
  - principal fields: `principalType` (`user|group|public|role`), `principalId` (`required` unless the type is `public`), `principalModel`;
  - resource fields: `resourceType`, `resourceId`;
  - permission fields: `permBits` (bitmask), `roleId` → `AccessRole`;
  - bookkeeping: `inheritedFrom`, `grantedBy`, `grantedAt`, `expiredAt` (TTL index, `:87`), `tenantId`.
- Bits: `VIEW=1, EDIT=2, DELETE=4, SHARE=8` (`packages/data-provider/src/accessPermissions.ts:58-68`). Named presets: `*_viewer`, `*_editor`, `*_owner` (`:74-95`). Docs: "Viewer `VIEW`… Editor `VIEW`+`EDIT`… Owner `VIEW`+`EDIT`+`DELETE`+`SHARE`" and "permissions are stored as a bitmask (`permBits`) against each (resource, principal) pair" (`librechat-ai/docs@9fdcbff:content/docs/features/access_control.mdx:112-122`).
- Groups: `Group {name, description, email, memberIds: string[], source: 'local'|'entra', idOnTheSource}`. `idOnTheSource` is required when the source is not local, and there is a unique index on `(idOnTheSource, source, tenantId)` (`packages/data-schemas/src/schema/group.ts:24-58`). Membership is an array stored on the group, not a join table.
- **The "everyone" principal is `PUBLIC`**, "A special principal that matches every authenticated user" (`access_control.mdx:212-214`). A **role** is also a principal: "Sharing an agent with a role… gives every user currently holding that role access" (`:208-210`).

**2. Semantics.**

- **New resources are private to the author.** Creating an agent grants `AGENT_OWNER` to the creator (`api/server/controllers/agents/v1.js:879-886`).
- **Public needs a feature permission.** Public grants are only permitted with the `SHARE_PUBLIC` feature permission (`access_control.mdx:214`).
- **Admin bypass is a capability.** `canAccessResource` lets a user through when they hold the capability mapped to the resource type, for example `manage:agents` (`api/server/middleware/accessResources/canAccessResource.js:72-86`; `packages/data-schemas/src/admin/capabilities.ts:180-188`). `seedSystemGrants` seeds every capability onto the `ADMIN` role (`packages/data-schemas/src/methods/systemGrant.ts:516-540`). Docs: "admins can manage any resource on the instance" (`access_control.mdx:146`).
- **Principals:** user, group, role, public.
- **Levels:** four bits, exposed as three presets.

**3. Enforcement.**

- **One principal resolver feeds both paths.** `getUserPrincipals` returns `[user, role, …groups, public]` (`packages/data-schemas/src/methods/userGroup.ts:855-903`).
  - **Direct access** uses it through `checkPermission` → `hasPermission(principals, type, id, bit)` (`api/server/services/PermissionService.js:146-160`; `packages/data-schemas/src/methods/aclEntry.ts:298-319`).
  - **List** uses it through `findAccessibleResources` → `AclEntry.find({$or: principals, permBits ⊇ bit}).distinct('resourceId')` (`PermissionService.js:250-270`; `aclEntry.ts:562-586`).
- **Route middleware:** `canAccessResource({resourceType, requiredPermission})` performs the per-request check (`canAccessResource.js:35-150`).
- **List handler:** passes `accessibleIds` into `getListAgentsByAccess` (`v1.js:1761-1850`).

**4. Group sources.**

- **Both local and Entra ID groups exist** (`access_control.mdx:186-191`).
- **Sync identity:** Entra sync runs at OIDC login with token reuse, and groups are keyed by the Entra Object ID (`idOnTheSource`), not by name.
- **Sync never touches local groups:**
  - It adds the user to `source:'entra'` groups and upserts missing groups (`PermissionService.js:552-626`).
  - It removes the user only from **`source:'entra'`** groups no longer in the token (`:632-640`).
  - "Early return if no groups found (protects against temporary API failures)" (`:540-545`).
- **Fan-out:** "A single resource shared with a 500-person group is one ACL entry (not 500)" (`access_control.mdx:191`).

**5. Admin UI.**

- **Grants:** edited on the resource. "Click the **Share** button…", then a people picker for users, groups and roles, plus a role per principal (`access_control.mdx:124-131`).
- **Groups:** managed in the admin panel.
- **Global capabilities:** granted separately, as "System Grants" (`:152-176`).

**6. Removal and cascade.**

- **Group delete** also deletes ACL entries for that group: "cascade cleanup", `deleteAclEntries({principalType: GROUP, principalId})` (`packages/api/src/admin/groups.ts:302-330`).
- **Admin user delete** does the same: `deleteAclEntries({principalType: USER, …})` (`packages/api/src/admin/users.ts:235-238`).
- **Self-delete** runs `removeUserFromAllGroups` and `deleteAclEntries({principalId})` (`api/server/controllers/UserController.js:554-555`).
- **Resource delete** calls `removeAllPermissions` (`PermissionService.js:708-730`).

## 3. Dify

Dify has two relevant layers:

- **Community:** workspace roles, plus per-knowledge-base access.
- **Enterprise:** web app access control. This is the same feature as B3's per-app access.

**1. Data model.**

- **Community roles:** one role per workspace member in `tenant_account_joins (tenant_id, account_id, role)`. Roles are `owner|admin|editor|normal|dataset_operator` (`langgenius/dify@2b65f0e:api/models/account.py:212-237`; `api/enums/account.py:7-12`). Docs: "**Normal**: Use published apps only" (`langgenius/dify-docs@4c06be1:en/self-host/use-dify/workspace/team-members-management.mdx:10-15`).
- **Community knowledge-base ACL:**
  - The resource holds a mode, `Dataset.permission ∈ {only_me, all_team_members, partial_members}`, default `only_me` (`api/models/dataset.py:168-171`; `api/models/enums.py:371-376`).
  - A per-account grant table holds the members: `dataset_permissions (dataset_id, account_id, tenant_id, has_permission)` (`dataset.py:826-848`).
  - There are no groups in Community.
- **Enterprise web apps:**
  - Each app has an access mode `public|private|private_all|sso_verified` (`api/enums/__init__.py:30-34`).
  - The UI maps them to labels: `SPECIFIC_GROUPS_MEMBERS: 'private'`, `ORGANIZATION: 'private_all'`, `EXTERNAL_MEMBERS: 'sso_verified'`, `PUBLIC: 'public'` (`web/models/access-control.ts:10-15`).
  - Grants are a subject list per app, `{subjectId, subjectType: 'group'|'account'}` (`web/models/access-control.ts:3-48`). They are stored in the closed-source Enterprise service, so the table shape is not public.
- **"Everyone"** is a mode (`private_all`, "All Members Within the Platform"), not a group.

**2. Semantics (Enterprise web app).**

- **New apps start closed.** "By default, new apps are restricted to specific team members" and "**Default setting for new apps.**" (`enterprise-docs.dify.ai/en/3.13.x/use/publish/webapp/web-app-access.md:9,39`). The API client also defaults to `private` (`api/services/enterprise/enterprise_service.py:38-43`).
- **An empty list means nobody:** "Without any groups or members selected, nobody can access your app, including you." (`web-app-access.md:42`)
- **Grants by group or by individual:**
  - By group: "When someone joins the group, they get app access. When they leave, access is revoked." (`:49`)
  - By individual: "They keep access even if removed from related groups." (`:57`)
- **No bypass for builders:** "Editing an app doesn't grant access to its published web app. Members who can edit the app still need to be added to the access list to use it." (`:62`)
- **Levels:** access only, with no read/write split for using an app. Changing the mode needs the "Manage access points" permission (Owner, Admins, the creator) (`:12-15`).

**3. Enforcement.**

- **Per request:** every web-app request decodes the passport. When the mode is `private` or `private_all` it calls `EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp(user_id, app_id)` and raises `WebAppAuthAccessDeniedError` on false (`api/controllers/web/wraps.py:135-162`; `PERMISSION_CHECK_MODES` at `enterprise_service.py:33-35`).
- **List** (installed / explore apps): `get_visible_app_ids` batch-fetches modes and per-user permissions. Apps with missing settings are **omitted** ("Missing access settings and SSO-only apps are omitted from the list") (`api/services/installed_app_access_service.py:64-83`).
- **Shared rules:** both paths go to the same Enterprise service, through a single endpoint and a batch endpoint (`enterprise_service.py:263-300`).
- **Community datasets:**
  - List: an SQL filter, `ALL_TEAM OR (ONLY_ME AND maintainer=me) OR (PARTIAL_TEAM AND id IN my_permitted_ids)` (`api/services/knowledge/dataset_service.py:163-216`).
  - Direct access: `check_dataset_operator_permission` / `can_access_dataset` (`:1300-1328`). The owner role bypasses it (`:1318`).

**4. Group sources.**

- Enterprise groups are created manually ("Group names must be unique") or synced by SCIM from Azure AD or Okta (`enterprise-docs …/administer/members-management.md:97-130`).
- **With SCIM the IdP is the "single source of truth":** "Admin APIs become read-only" (`…/administer/members/synchronization/sync-team-members.md:84-92`).
- Group delete over SCIM: "Deleting a group removes it permanently along with member relationships" (`:79`).
- LDAP is not a listed group source in these pages.

**5. Admin UI.**

- **Grants:** edited on the app, on its Access Point page under "Web App Access Control" (`web-app-access.md:19-23`; `web/app/components/app/app-access-control/`).
- **Groups and members:** managed on the Enterprise dashboard Members page.
- **Audit:** "**Who has access** shows the level and, for specific members, the selected groups and members" (`web-app-access.md:107`).

**6. Removal and cascade.**

- **App delete:** cleans the Enterprise web-app settings with `WebAppAuth.cleanup_webapp(app.id)` (`api/services/app_service.py:902-904`).
- **Dataset delete:** removes its `dataset_permissions` rows (`dataset_service.py:3908, 3940`).
- **Member delete** (Enterprise): "any resources they previously created … will be automatically transferred to the workspace owner" (`members-management.md:37`).

## 4. Grafana

**1. Data model.**

- **Teams:** `team (id, name, org_id, …)` and `team_member (id, org_id, team_id, user_id, external bool, permission)` (`grafana/grafana@c80649e:pkg/services/sqlstore/migrations/team_mig.go:7-13, 49-56, 78-84`). `External` "Signals that the membership has been created by an external systems, such as LDAP" (`pkg/services/team/model.go:149`).
- **RBAC roles:** `role`, plus `permission (role_id, action, scope)`, plus the assignment tables `user_role`, `team_role` and `builtin_role` (`pkg/services/sqlstore/migrations/accesscontrol/migrations.go:11-118`).
- **Resource grants are stored as managed roles per principal:**
  - role names `managed:users:<id>:permissions`, `managed:teams:<id>:permissions` and `managed:builtins:<role>:permissions` (`pkg/services/accesscontrol/accesscontrol.go:409-419`);
  - each holds rows such as `(dashboards:read, dashboards:uid:abc)`.
- **"Everyone" is the organization's basic roles** (Viewer, Editor, Admin), which can be principals on a folder. There is no all-users team.

**2. Semantics.**

- **Folder defaults:** "**Folders created in the UI** are automatically granted: Admin role gets Admin permission, Editor role gets Edit permission, Viewer role gets View permission". "Folders created via as-code … only have permissions explicitly defined" (`grafana/grafana@7b702d7:docs/sources/administration/roles-and-permissions/folder-access-control/index.md:33-36`).
- **Creator:** "When a user creates a dashboard or folder at the top level, they are automatically granted Admin permissions for it" (`docs/sources/administration/roles-and-permissions/_index.md:125`).
- **Inheritance:** permissions cascade down folders (`folder-access-control/index.md:98-108`).
- **Admin bypass:** "**Organization administrator**: Has access to all organization resources" (`_index.md:87`). The legacy API: "Permissions cannot be set for Admins - they always have access to everything".
- **Principals:** user, team, basic role.
- **Levels:** View < Edit < Admin (`folder-access-control/index.md:52-56`).

**3. Enforcement.**

- **Model:** each call evaluates `accessControl.Evaluate(ctx, user, EvalPermission(action, scope))` against the user's resolved permission set, which is the union of basic role, team roles and user roles. Example: the folder read check (`pkg/services/folder/folderimpl/folder_unifiedstorage.go:384-388`).
- **List filter:** this run did not trace the list filter in the current search code (see Not confirmed).

**4. Group sources.**

- **Teams are always local.** Team Sync (Enterprise or Cloud) links a team to external group ids, such as an LDAP DN or an OAuth group, on the team's "External group sync" tab (`docs/sources/setup-grafana/configure-access/configure-team-sync.md:44-58`).
- **Synced and manual memberships coexist:** "This mechanism allows Grafana to remove an existing synchronized user from a team when its group membership changes. This mechanism also enables you to manually add a user as member of a team, and it will not be removed when the user signs in." (`:25`)
- **Timing:** "the synchronization only happens when a user logs in, unless LDAP is used with the active background synchronization" (`:27`).

**5. Admin UI.**

- **Grants:** edited on the resource, on the folder or dashboard Permissions tab. A folder Admin permission is needed to manage them (`folder-access-control/index.md:18-22`).
- **Team pages:** these manage members and external groups.

**6. Removal and cascade.**

- **Team delete** calls `DeleteTeamPermissions`. That function deletes the `team_role` rows, the permissions scoped to the team, and the managed team role with its permissions (`pkg/services/team/teamapi/team.go:185-188`; `pkg/services/accesscontrol/database/database.go:444-500`).
- **User removal** calls `DeleteUserPermissions` (`pkg/api/admin_users.go:256`, `pkg/api/org_users.go:697-736`; `database.go:376-…`).

## 5. Metabase

**1. Data model.**

- **Tables:**
  - `permissions_group (id, name)`;
  - `permissions_group_membership (user_id FK ON DELETE CASCADE, group_id FK ON DELETE CASCADE, is_group_manager)`;
  - `permissions (id, object varchar, group_id FK ON DELETE CASCADE)` (`metabase/metabase@1c4f3ab:resources/migrations/initialization/metabase_postgres.sql:864-904, 3650-3670`).
- **Grants are paths:** a grant is a slash path such as `/collection/1/read/`, held by a **group only**. Users never receive grants directly ("Permissions are granted to individual … PermissionsGroups") (`src/metabase/permissions/models/permissions.clj:1-31`).
- **There is a built-in everyone group.** "Every Metabase has two default groups: Administrators and All Users. These are special groups that can't be removed" (`docs/people-and-groups/managing.md:177`). "Every Metabase user is always a member of this group" (`:185`). The code calls them "magic" groups and refuses edit or delete (`src/metabase/permissions/models/permissions_group.clj:1-12, 94-104`).

**2. Semantics.**

- **Inheritance:** new sub-collections inherit the parent's access ("all _new_ subcollections will inherit the access level") (`docs/permissions/collections.md:73`).
- **Watch the All Users group:** "By default, everyone is in the All users group, so be sure to block that group's access before granting permissions to other groups" (`docs/permissions/introduction.md:18`).
- **Admins have everything:** they "always have unrestricted access to all data" (`managing.md:181`) because they hold the root path `/` (`permissions.clj:51-53`).
- **Principals:** groups only. The exception is personal collections, which have fixed per-user access.
- **Levels:** Curate / View / No access (`collections.md:10-43`).
- **Most permissive wins:** "collection permissions are _additive_… they'll be given the _more permissive_ setting" (`collections.md:69`; `introduction.md:17`).

**3. Enforcement.**

- "The union of all permissions the current User's gets from all groups … are automatically bound to `*current-user-permissions-set*` … for every REST API request" (`permissions.clj:29-31`).
- List and direct checks both test against this per-request permission set by path prefix.

**4. Group sources.**

- **Local groups, plus mappings:** LDAP, SAML and JWT add group _mappings_ from a directory group DN to existing Metabase groups (`docs/people-and-groups/ldap.md:65-76`). There is no automatic creation.
- **Sync never touches unmapped groups:** "People are only ever added to or removed from mapped groups. The sync has no effect on Metabase groups that don't have an LDAP mapping." (`ldap.md:86`). It takes effect "only _after_ people log back in" (`:85`).
- **The code agrees:** `sync-group-memberships!` with `mapped-groups-or-ids` only diffs within the mapped set and excludes All Users (`src/metabase/sso/common.clj:11-15, 47-65`).

**5. Admin UI.**

- **Grants:** edited on the collection (lock icon → Edit permissions), or in Admin → Permissions → Collections, which shows a grid of groups per collection. "Only Administrators can edit collection permissions" (`collections.md:61-63`).

**6. Removal and cascade.**

- **Group delete:** FK `ON DELETE CASCADE` removes the group's `permissions` and memberships (`metabase_postgres.sql:3654, 3662`). A before-delete hook also strips the group id out of `ldap-group-mappings` (`permissions_group.clj:124-131`).
- **Magic groups:** cannot be deleted.

## 6. Langfuse (Next.js and Prisma, the same stack family as the hub)

**1. Data model.**

- **No groups.** Langfuse has `OrganizationMembership (orgId, userId, role)` and an optional `ProjectMembership (projectId, userId, role)` override. Roles are `OWNER|ADMIN|MEMBER|VIEWER|NONE` (`langfuse/langfuse@c106bb3:packages/shared/prisma/schema.prisma:487-549`).

**2. Semantics.**

- "A user's effective role in a project is their project-level role if one is assigned, otherwise their organization role… Projects in which the effective role lacks `project:read` are hidden from the user entirely" (`langfuse/langfuse-docs@1e00c80:content/docs/administration/rbac.mdx:309`).
- To limit a user to some projects, "set their role to `None` on the organization level and then assign them a role on the project level" (`:349`).
- **Bypass:** an instance `admin` flag bypasses checks (`web/src/features/rbac/utils/checkProjectAccess.ts:53-56`).

**3. Enforcement.**

- **One rule table serves the list and the check:**
  - The next-auth `session` callback reads memberships from the DB on each session read and filters the project list with `projectRoleAccessRights[project.role].includes("project:read")` (`web/src/server/auth.ts:763-800, 947-974`).
  - tRPC procedures call `throwIfNoProjectAccess`, which uses the same `projectRoleAccessRights[role].includes(scope)` (`checkProjectAccess.ts:25-65`).

**4–6.** No group sources in these docs. The memberships use Prisma `onDelete: Cascade` on user, org and project (`schema.prisma:490-510`). Grants are edited on the org's and the project's members settings.

---

## Comparison table

|  | Open WebUI | LibreChat | Dify EE web app (CE datasets) | Grafana | Metabase | Langfuse |
| --- | --- | --- | --- | --- | --- | --- |
| Grant storage | `access_grant` table (resource, principal type+id, read/write); JSON column until 2026-02 | `AclEntry` (principal type+id, resource, `permBits`) | subjects (group/account) per app in EE service; CE `dataset_permissions` per account + mode on resource | managed role per principal + `permission(action, scope)` | `permissions(group_id, object path)` | membership rows with a role per org and per project |
| Principals | user, group, `user:*`, `anyone:*` | user, group, role, public | group, account (+ modes) | user, team, basic role | group only | user only |
| Built-in "everyone" | no group; wildcard grant | `PUBLIC` principal | mode `private_all` | basic roles Viewer/Editor | **All Users** group (can't delete) | org-level role |
| New resource default | private to owner; ownerless config = admin-only | private (owner grant) | **specific members, empty list = nobody** (CE dataset: `only_me`) | UI folder: Viewer=View, Editor=Edit; top-level creator=Admin | inherits parent collection | org role applies |
| Admin bypass | yes, flag (default on) for lists; per-id always | yes, via `manage:*` capability | **no for using an app**; owner bypass on CE datasets | org admin: everything | Administrators: root `/` | instance admin flag |
| Levels | read / write | view / edit / delete / share (3 presets) | access only | view / edit / admin | no / view / curate | role scopes |
| List vs direct check | same table and principal set; two methods | same `getUserPrincipals` + `AclEntry`; two methods | same EE service (batch vs single) | same evaluated permission set | same per-request permission set | same `projectRoleAccessRights` |
| Group sources | local, OAuth, LDAP, trusted header | local, Entra ID | manual, SCIM (Azure, Okta) | local teams + Team Sync (Enterprise) | local + LDAP/SAML/JWT mappings | none |
| Synced vs local | by **name**; strict sync **also removes local memberships** (blocklist escape) | by **external id**; only `source:'entra'` groups touched | SCIM = single source of truth; admin APIs read-only | membership flagged `external`; manual members kept | only **mapped** groups touched | n/a |
| Where grants are edited | on the resource (Access modal) + per-user/group preview | on the resource (Share dialog) | on the app (Access Point) | on the folder/dashboard | on the collection + admin grid | org/project members |
| Group/user delete removes grants | resource delete yes; group/user: none found | yes (app-level cascade) | app delete cleans settings | yes (`DeleteTeamPermissions`, `DeleteUserPermissions`) | yes (FK cascade) | yes (FK cascade) |

## Patterns most projects share

1. **A separate grant (ACL) relation:** a resource, a principal given by type and id, and a level. You see it in Open WebUI's `access_grant`, LibreChat's `AclEntry`, Dify's `{subjectType, subjectId}` and `dataset_permissions`, Metabase's `permissions`, and Grafana's per-principal managed roles. Open WebUI moved _from_ a JSON column on the resource _to_ this table in February 2026.
2. **Union semantics without deny.** Every surveyed project grants access if any principal (user, any group, public) matches. Open WebUI says "'Deny' permissions do not exist". LibreChat ORs the bits. Metabase applies "most permissive".
3. **Groups and single users can both be principals.** Open WebUI, LibreChat, Grafana and Dify EE allow both. Metabase allows groups only and Langfuse users only, so these are the exceptions.
4. **"Everyone" is a principal or a mode, never "no rule".** Open WebUI uses `user:*`, LibreChat `PUBLIC`, Dify `private_all`, and Grafana basic roles as principals. Metabase uses a built-in, undeletable All Users group.
5. **The list filter and the per-request check read the same principal set and the same grant data.** LibreChat has `getUserPrincipals`, Open WebUI `AccessGrantsTable`, Langfuse `projectRoleAccessRights`, and Dify one Enterprise service with batch and single endpoints. In practice there are two functions, one for the list and one for a single object, built on one rule. Most of them fail closed: Dify omits apps without settings, and Open WebUI shows unconfigured models to admins only.
6. **Directory groups are matched by a stable external id** where the project is careful about it: LibreChat `idOnTheSource` (Entra OID), and Grafana and Metabase with an explicit DN-to-local-group mapping. Membership is updated **at login**. Grafana adds an LDAP background sync.
7. **Synced memberships are kept apart from manual ones:**
   - Grafana flags them `external`;
   - LibreChat only touches `source:'entra'` groups;
   - Metabase only touches mapped groups.
8. **Removal cleans up.** Deleting a resource removes its grants everywhere. Deleting a group or a user removes its grants in LibreChat, Grafana and Metabase (by code or by FK cascade).
9. **Grants are edited on the resource,** in an access or share dialog on the app, folder or collection. A per-user or per-group "who can see what" view is an extra: Open WebUI Preview Access, Metabase permission grid, Dify "Who has access".

## Where they disagree

- **Default for a new resource:**
  - private to its creator: Open WebUI, LibreChat;
  - restricted with an empty list, meaning _nobody, including the creator_: Dify EE web apps;
  - open to the org's basic roles: Grafana UI folders;
  - inherited from a parent: Metabase, Grafana nested;
  - visible only to admins when ownerless and unconfigured: Open WebUI admin-configured resources and unconfigured models.
- **Admin bypass:**
  - Most projects bypass: Grafana org admin, Metabase admins, LibreChat capability.
  - Open WebUI makes it a flag, default on, and still always lets admins reach per-id endpoints.
  - Dify EE does **not** let builders use a web app unless they are on its list.
- **What a sync may change:**
  - Open WebUI strictly overwrites membership, _including_ local groups, matching by group **name**.
  - LibreChat, Grafana and Metabase touch only synced or mapped memberships.
  - Dify EE with SCIM makes the IdP the single source of truth and turns admin edits read-only.
- **Creating groups from the directory:**
  - automatic just-in-time creation: Open WebUI `ENABLE_*_GROUP_CREATION`, LibreChat upsert by external id;
  - admin-created local groups mapped explicitly to directory groups: Grafana Team Sync, Metabase group mappings.
- **Permission levels:**
  - visibility or use only: Dify web apps;
  - read and write: Open WebUI;
  - bit flags with presets: LibreChat;
  - ordered levels: Grafana View, Edit, Admin and Metabase No, View, Curate.
- **Cleanup on group delete:** explicit cascade in LibreChat and Grafana, an FK cascade in Metabase, and nothing found in Open WebUI, whose orphan grants are inert.
- **Membership storage:**
  - a join table: Open WebUI `group_member`, Grafana `team_member`, Metabase `permissions_group_membership`;
  - an array on the group: LibreChat `memberIds`.

## Guidance: OWASP and the Next.js 16 bundled docs

**OWASP Authorization Cheat Sheet** (`OWASP/CheatSheetSeries@29994dd:cheatsheets/Authorization_Cheat_Sheet.md`):

- **"Deny by Default"** (heading `:30`): "For security purposes an application should be configured to deny access by default" (`:32`). And: "Adopt a 'deny-by-default' mentality both during initial development and whenever new functionality or resources are exposed by the app. One should be able to explicitly justify why a specific permission was granted to a particular user or group rather than assuming access to be the default position." (`:36`)
- **Every request** (heading `:39`, "Validate the Permissions on Every Request"): "Permission should be validated correctly on every request… Validating permissions correctly on just the majority of requests is insufficient." (`:41`)
  - The exact phrase "enforce on every request" does **not** appear in the cheat sheet. The wording is "Validate the Permissions on Every Request".
  - The IDOR section adds: "Perform access control checks on _every_ request for the _specific_ object or functionality being accessed. Just because a user has access to an object of a particular type does not mean they should have access to every object of that particular type." (`:99`)
- **"Enforce Least Privileges"** (heading `:17`): "assigning users only the minimum privileges necessary"… "periodically review permissions in the system for 'privilege creep'" (`:19, :27`).
- **Failure handling:** "Centralize the logic for handling failed access control checks." (`:118`)
- **Testing:** tests should ask "is access being denied by default?" (`:135`)

**Next.js 16.3.4 bundled docs** (`node_modules/next/dist/docs/01-app/02-guides/`):

- `data-security.md:58-66`: "A Data Access Layer should: Only run on the server. Perform authorization checks. Return safe, minimal Data Transfer Objects (DTOs). This approach centralizes all data access logic, making it easier to enforce consistent data access and reduces the risk of authorization bugs."
- `data-security.md:370`: "Beyond authentication (is the user logged in?), remember to check **authorization** (does this user have permission to act on this specific resource?). This prevents Insecure Direct Object Reference (IDOR) vulnerabilities".
- `data-security.md:399, 432`: "This keeps authentication, authorization, and database logic in a dedicated `server-only` module, while `"use server"` actions stay thin" and "`await deletePost(postId) // Auth + authz happen inside the DAL`".
- `authentication.md:1121`: "While Proxy can be useful for initial checks, it should not be your only line of defense in protecting your data. The majority of security checks should be performed as close as possible to your data source".
- `authentication.md:1133`: "We recommend creating a DAL to centralize your data requests and authorization logic."
- `authentication.md:1352-1360`: on layouts, "be cautious when doing checks in Layouts as these don't re-render on navigation… Instead, you should do the checks close to your data source… This guarantees that wherever `getUser()` is called within your application, the auth check is performed".
- `authentication.md:1463, 1503`: "Treat Server Actions…" and "Treat Route Handlers with the same security considerations as public-facing API endpoints, and verify if the user is allowed to access the Route Handler."

## Points the B3 design will have to settle

These come out of the disagreements above. They are not decisions.

- **Which projects are the right analogue?** The hub's apps are admin-configured and have no owner. The closest analogues are Open WebUI's "admin-configured resources" (no grants = admin-only) and Dify EE web apps (new app = specific members, empty = nobody). Owner-centred models (LibreChat, Open WebUI workspace items) fit less well.
- **The default for a new app and for existing apps at migration.** Options: closed (Dify EE, OWASP deny by default), or an explicit "everyone" grant written by the migration. Open WebUI's migration turned `NULL` into `user:*:read` so that existing resources stayed public.
- **How "everyone" is represented:** a wildcard principal (Open WebUI, LibreChat), a mode on the app (Dify), or a built-in undeletable group (Metabase).
- **Whether owner and admin bypass for _using_ an app.** Most projects bypass. Dify EE does not.
- **Levels:** visibility or use only (Dify web apps) is enough if editing stays admin-only.
- **For LDAP later:** match by external id or DN, not by name. Touch only synced or mapped memberships (LibreChat, Grafana, Metabase) rather than Open WebUI's strict overwrite. Choose between JIT group creation and explicit mapping.
- **Cascade:** remove grants when a group or user is deleted. An FK cascade is possible when the grant table has typed FK columns. A polymorphic `principal_id` needs application-level cleanup, as in LibreChat and Grafana.

## Not confirmed

- **Open WebUI grant cleanup on group or user delete.** No code was found that deletes `access_grant` rows naming a deleted group or user. The search was `grep` over `backend/open_webui` for deletes by principal. The orphans would be inert, but this is an inference from source search, not from docs.
- **LibreChat Entra groups.** Whether Entra-sourced groups are read-only in the admin panel: no lock was found in `packages/api/src/admin/groups.ts`.
- **Dify Enterprise storage.** The grant storage (tables) is in the closed-source Enterprise service. Only the API and UI shape (`subjectType` group/account) is visible.
- **Dify Enterprise bypass.** Whether the workspace Owner bypasses web-app access is not stated. The docs say "nobody … including you" and "Editing an app doesn't grant access".
- **Dify Enterprise doc pinning.** The pages come from `enterprise-docs.dify.ai/en/3.13.x/…` (Mintlify, version 3.13.x). They are not git-pinned and were fetched on 2026-10-09.
- **Dify Community cleanup.** Whether removing a workspace member deletes their `dataset_permissions` rows was not found.
- **Grafana list filter.** The list filter for dashboards and folders was not traced to file:line in the current code, where search has moved to unified storage. Per-object `Evaluate` is confirmed for folders.
- **Grafana Team Sync edition.** Team Sync is Enterprise and Cloud only (per docs). The open-source LDAP group-to-org-role mapping was not reviewed here.
- **Grafana pins.** The docs were read at `7b702d7`. The source was read at `c80649e`, because the branch moved between pinning and cloning.
- **Metabase defaults.** The default permissions of All Users on the root collection in a fresh install were not checked.
- **Langfuse groups and SCIM.** Neither appears in the RBAC docs read here. Other Langfuse pages were not searched.

## Pinned sources

- **Open WebUI**
  - `open-webui/open-webui@8bd8b4fac5e059578ac0c74b3c18d11139f88b7d` (2026-09-21)
    - `backend/open_webui/models/{access_grants,groups,users,models,knowledge}.py`
    - `backend/open_webui/utils/{models,oauth}.py`
    - `backend/open_webui/utils/access_control/__init__.py`
    - `backend/open_webui/routers/{auths,groups}.py`
    - `backend/open_webui/{main,config}.py`
    - `backend/open_webui/migrations/versions/f1e2d3c4b5a6_add_access_grant_table.py`
    - `src/lib/components/workspace/{common/AccessControl.svelte,Models/ModelEditor.svelte}`
  - `open-webui/docs@81b07ae46dbd3d8a79192315a860357a4ed90e7d`
    - `docs/features/authentication-access/rbac/{groups.md,roles.md,permissions.md,index.mdx}`
    - `docs/features/authentication-access/auth/{sso/index.mdx,ldap.mdx}`
    - `docs/reference/env-configuration.mdx`
- **LibreChat**
  - `danny-avila/LibreChat@e1dfc10449ff713faffacd60273fddcfe2c0a698`
    - `packages/data-schemas/src/schema/{aclEntry,group,accessRole}.ts`
    - `packages/data-schemas/src/methods/{aclEntry,userGroup,systemGrant}.ts`
    - `packages/data-schemas/src/admin/capabilities.ts`
    - `packages/data-provider/src/accessPermissions.ts`
    - `api/server/services/PermissionService.js`
    - `api/server/middleware/accessResources/canAccessResource.js`
    - `api/server/controllers/agents/v1.js`
    - `api/server/controllers/UserController.js`
    - `packages/api/src/admin/{groups,users}.ts`
  - `librechat-ai/docs@9fdcbff6f8a0037f4fc2ac92c14d7c9b19f1f4dc`: `content/docs/features/access_control.mdx`
- **Dify**
  - `langgenius/dify@2b65f0e8930964ce2be9e7054dde5a2cd74ff605`
    - `api/enums/{__init__,account}.py`
    - `api/models/{account,dataset,enums}.py`
    - `api/services/enterprise/{enterprise_service,app_permitted_service}.py`
    - `api/services/installed_app_access_service.py`
    - `api/services/webapp_access_query_service.py`
    - `api/controllers/web/wraps.py`
    - `api/extensions/ext_application_services.py`
    - `api/services/knowledge/dataset_service.py`
    - `api/services/app_service.py`
    - `web/models/access-control.ts`
  - `langgenius/dify-docs@4c06be15ad26b1f9546a9042739206db4425e053`
    - `en/self-host/use-dify/workspace/team-members-management.mdx`
    - `en/self-host/use-dify/knowledge/manage-knowledge/introduction.mdx`
  - Dify Enterprise docs 3.13.x, fetched on 2026-10-09:
    - `https://enterprise-docs.dify.ai/en/3.13.x/use/publish/webapp/web-app-access.md`
    - `…/administer/members-management.md`
    - `…/administer/members/synchronization/sync-team-members.md`
- **Grafana**
  - source: `grafana/grafana@c80649e8388a50e717dcba68353894ca1112ca33`
    - `pkg/services/sqlstore/migrations/{team_mig.go,accesscontrol/migrations.go}`
    - `pkg/services/team/{model.go,teamapi/team.go}`
    - `pkg/services/accesscontrol/{accesscontrol.go,database/database.go}`
    - `pkg/services/folder/folderimpl/folder_unifiedstorage.go`
    - `pkg/api/{admin_users,org_users}.go`
  - docs: `grafana/grafana@7b702d7969564cb677ae3e3f393dedd6f867264e`
    - `docs/sources/administration/roles-and-permissions/{_index.md,folder-access-control/index.md}`
    - `docs/sources/setup-grafana/configure-access/configure-team-sync.md`
  - Context7 `/websites/grafana_grafana` (legacy folder permissions API: "Permissions cannot be set for Admins")
- **Metabase:** `metabase/metabase@1c4f3ab9e83debb1ea6263a66dee94fdddaea753`
  - `docs/people-and-groups/{managing,ldap}.md`
  - `docs/permissions/{introduction,collections}.md`
  - `src/metabase/permissions/models/{permissions,permissions_group}.clj`
  - `src/metabase/sso/common.clj`
  - `resources/migrations/initialization/metabase_postgres.sql`
- **Langfuse**
  - `langfuse/langfuse@c106bb3d945323688e6f6079f65fb0ab28203b53`
    - `packages/shared/prisma/schema.prisma`
    - `web/src/features/rbac/utils/checkProjectAccess.ts`
    - `web/src/server/auth.ts`
  - `langfuse/langfuse-docs@1e00c807951209476f8690755995476897e4bd33`: `content/docs/administration/rbac.mdx`
- **OWASP:** `OWASP/CheatSheetSeries@29994dd8a2e6f50fa3d5607b046b54d7c6945afd`: `cheatsheets/Authorization_Cheat_Sheet.md`
- **Next.js 16.3.4 bundled docs:** `node_modules/next/dist/docs/01-app/02-guides/{data-security,authentication}.md`
- **Context7 libraries used:** `/open-webui/docs`, `/librechat-ai/docs`, `/websites/enterprise-docs_dify_ai`, `/langgenius/dify-docs`, `/websites/grafana_grafana`
