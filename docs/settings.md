# Settings

Each settings area is set in one of two ways, chosen by one environment variable per area (ADR-0030):

| Mode | Where the values come from | What Settings shows |
| --- | --- | --- |
| `disabled` (also when unset) | Nowhere: the area is off. For branding, the built-in name and logo. | A notice and, for branding, the built-in preview. |
| `env` | Environment variables (and mounted files). | The values, read-only, each beside its variable, with any file that could not be used. |
| `database` | The admin page (Settings in the admin sidebar), stored in the database. The area's environment variables are ignored. | A form. The owner and admins can edit it. |

The mode variable ignores case and blanks around the value (`Database` reads as `database`). Any other value is an error that names the variable (`Missing or invalid environment variables: BRANDING_MODE`), and the hub serves no page until it is fixed; so is a missing or invalid variable of an area in `env` mode.

Changing a mode, or any value in `env` mode, takes a restart of the hub container. A value saved in `database` mode applies on the next page load in every hub container. A row saved in `database` mode is kept when you switch to another mode, and comes back when you switch back.

## Branding

`BRANDING_MODE=disabled|env|database`.

In `env` mode:

| Variable | Meaning |
| --- | --- |
| `BRANDING_NAME` | Required. 1–64 characters: the header, the login card, the browser tab. |
| `BRANDING_SHOW_NAME` | `true` (default) or `false`: the name beside the logo. `false` needs a logo file (a wordmark). |
| `BRANDING_LOGO_FILE` | Optional. Path inside the container to a PNG, JPEG or WebP of up to 512 KB. |
| `BRANDING_FAVICON_FILE` | Optional. The browser-tab icon, a PNG, JPEG or WebP of up to 256 KB. Without it, the logo is used. |

Mount the files read-only, for example in `docker-compose.yml`:

```yaml
services:
  app:
    environment:
      BRANDING_MODE: env
      BRANDING_NAME: Acme AI Hub
      BRANDING_LOGO_FILE: /branding/logo.png
    volumes:
      - ./branding:/branding:ro
```

Every image, uploaded or mounted, is decoded and saved again as a PNG (a logo at most 768 × 192 pixels, an icon 64 × 64), so the hub never serves the original file. PNG, JPEG and WebP are accepted; SVG is not, so export an SVG logo to PNG first (ADR-0030). An image of more than 16,777,216 pixels (4096 × 4096) is refused, whatever its file size. A file that cannot be read or is not an accepted image is logged once, on the first page load after the hub starts, by its variable (`BRANDING_LOGO_FILE could not be used: { code: 'ENOENT' }`) and shown on the Branding page; the hub runs without it. The code is the system's (`ENOENT`, `EACCES`) or the hub's own: `too_large` (over the size limit) or `not_allowed` (not a regular file, or not a PNG, JPEG or WebP that decodes).

Whenever no logo can be shown, the name is shown, even with `BRANDING_SHOW_NAME=false`, so the header is never empty.

The images are served at `/api/branding/logo` and `/api/branding/favicon`, without sign-in, because the login page shows them.
