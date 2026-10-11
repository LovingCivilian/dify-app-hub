# Docs and standards for the settings layer and branding

What the libraries' current documentation and the relevant standards say, for each piece of the design (ADR-0002). Next.js paths are the bundled docs of the installed version (`node_modules/next/dist/docs/`); antd facts come from `@ant-design/cli` (`antd info`, `antd demo`); Drizzle and sharp from Context7; OWASP and Docker pages were saved on 2026-10-11 with crawl4ai.

## Next.js 16 (bundled docs)

| Topic | What the docs say | Where |
| --- | --- | --- |
| Runtime values for the browser | `NEXT_PUBLIC_` variables "will be frozen with the value evaluated at build time … If you need access to runtime environment values, you'll have to set up your own API to provide them to the client" | `01-app/02-guides/environment-variables.md:166` |
| Icons in metadata | "File-based metadata has the higher priority and will override the `metadata` object and `generateMetadata` function" | `01-app/03-api-reference/04-functions/generate-metadata.md:114` |
| One read per request | "React `cache` can be used if `fetch` is unavailable" to memoize across `generateMetadata`, layouts, pages and Server Components | `generate-metadata.md:195` |
| Server Action body | "By default, the maximum size of the request body sent to a Server Action is 1MB"; the limit "applies to the raw HTTP request body, including the bytes that `multipart/form-data` adds"; `serverActions.bodySizeLimit` raises it | `01-app/03-api-reference/05-config/01-next-config-js/serverActions.md:29-45` |
| Refresh after a save | `revalidatePath` in Server Functions "Updates the UI immediately (if viewing the affected path)" | `01-app/03-api-reference/04-functions/revalidatePath.md:13-19` |
| `next/image` sizes | `width` and `height` are required unless "The image is statically imported" or "has the `fill` property" | `01-app/03-api-reference/02-components/image.md:105-113` |
| `next/image` `unoptimized` | serves the source as is, without the optimizer | `image.md:391-412` |
| sharp | "The only additional dependency is the `sharp` package, which is required for Image Optimization"; sharp is in the built-in `serverExternalPackages` list | `01-app/02-guides/deploying-to-platforms.md:20`; `…/serverExternalPackages.md:89` |

## Drizzle ORM (Context7 `/drizzle-team/drizzle-orm-docs`)

- MySQL `json` columns typed with `.$type<T>()` (`json('tags1').$type<string[]>().notNull()`), guide "Set empty array default in MySQL with json column" (`src/content/docs/guides/empty-array-default-value.mdx`).
- Binary bytes: the hub already stores app icons in `mediumblob('icon_image', { mode: 'buffer' })` (`db/schema/apps.ts:48`).

## antd 6 (`@ant-design/cli`)

- Layout demo "Sider" (`antd demo Layout side`): a collapsible `Layout.Sider` holding `<Menu mode="inline" items={items}>` whose items carry `children` (the "User" and "Team" groups).
- Menu props (`antd info Menu`): `items`, `defaultOpenKeys` (`string[]`), `openKeys`, `onOpenChange`, `selectedKeys`, `inlineCollapsed`, `triggerSubMenuAction` (`hover` | `click`, default `hover`).
- Upload demos: `upload-manually` (files kept in the browser and sent on demand), `upload-png-only` (type check in `beforeUpload`), `max-count`.

## sharp 0.35 (Context7 `/lovell/sharp`; installed as Next's dependency, `sharp@0.35.4`)

- Every input defaults to `failOn(VIPS_FAIL_ON_WARNING)` (input rejected on any decoder warning), `limitInputPixels` `0x3FFF * 0x3FFF`, `limitInputChannels` 5 (`src/common.h`); SVG input uses the same controls (`src/common.cc`).
- `resize({ height, fit: 'inside', withoutEnlargement })` (`docs/src/content/docs/api-resize.md`); `png()` output options (`api-output.md`).
- "By default all metadata will be removed, which includes EXIF-based orientation" (`api-output.md`).

## OWASP File Upload Cheat Sheet (cheatsheetseries.owasp.org, saved 2026-10-11)

- "Validate the file type, don't trust the Content-Type header as it can be spoofed"; "Set a file size limit".
- Content-Type validation "provides a quick check to prevent users from unintentionally uploading files with the incorrect type", allowlist preferred; file signature validation "in conjunction with" it.
- "For images, decode and re-encode to an allowed image format, explicitly removing unnecessary metadata … Use an up-to-date library with restricted formats, resource limits, and sandboxing."

## OWASP Cryptographic Storage Cheat Sheet (saved 2026-10-11)

- "Where available, authenticated modes should always be used … GCM and CCM … should be used as a first preference."
- "Enforce the mode's limits on message size, encryption operations, and initialization vector (IV) uniqueness … AES-GCM has separate requirements for input lengths and IV construction in NIST SP 800-38D, Sections 5.2.1.1 and 8."
- Rotation: re-encrypting existing data with the new key "should generally be preferred" over keeping several keys with key ids.
- "Avoid storing keys in environment variables, as these can be accidentally exposed through functions such as phpinfo() or through the /proc/self/environ file."
- "Where possible, encryption keys should be stored in a separate location from encrypted data. For example, if the data is stored in a database, the keys should be stored in the filesystem."

## Docker Compose secrets (docs.docker.com/compose/how-tos/use-secrets/, saved 2026-10-11)

- "Docker Compose provides a way for you to use secrets without having to use environment variables to store information … Environment variables are often available to all processes, and it can be difficult to track access."
- "Secrets are mounted as a file in `/run/secrets/<secret_name>` inside the container."
- n8n reads its key from `N8N_ENCRYPTION_KEY_FILE` the same way (`reference-projects.md`).

## W3C WAI Images Tutorial, Functional images (w3.org/WAI/tutorials/images/functional/, read 2026-10-11)

- Example 1, "Image used alone as a linked logo": the image "is the only content of a link that leads to the W3C home page. It has the text alternative 'W3C home' to indicate where the link will take the user."
- Example 2, "Logo image within link text": "The image does not represent different functionality or convey other information than that already provided in the link text, so a null (empty) value is applied, (`alt=""`), to avoid redundancy and repetition."
