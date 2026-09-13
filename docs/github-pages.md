# Public project website

The OpenEval project site is published at https://rasputinkaiser.github.io/OpenEval/.
It is a static introduction, interactive illustration, installation guide, and
index of documentation/community links, plus an illustrative chart-to-transcript explorer
and three playable reference solutions. The Node/SQLite dashboard runs locally;
GitHub Pages does not host its server, APIs, or private transcript data.

## Edit and preview

Edit `site/index.html`, `site/styles.css`, and `site/site.js`. The chart uses
explicit example data; never present it as measured agent performance.

```bash
node scripts/build-pages.mjs
node scripts/check-pages.mjs
python3 -m http.server 3180 --bind 127.0.0.1 --directory .pages-dist
```

The dependency-free build inserts the package version and counts the checked-in
case definitions. It copies only an explicit list of public website assets into
`.pages-dist/`. The three `demos/` files come from an explicit reference-solution allowlist and
receive a restrictive Content Security Policy. The website loads one demo at a
time only after Play, in an iframe with `sandbox="allow-scripts"` and no same-origin
permission. Stop removes the frame; switching demos stops playback. No runtime
database, private transcript, environment file, or application bundle belongs in
that artifact. The included PNG is the raster social-card
counterpart of `site/social.svg`; update them together when branding changes.

## Publish

`.github/workflows/pages.yml` validates site changes in pull requests. On relevant
pushes to `main`, or a manual workflow dispatch, it uploads the static artifact and
deploys through the `github-pages` environment. Only the deploy job gets Pages
write and OIDC permissions; pull requests cannot deploy. GitHub Pages uses the
GitHub Actions publishing source. No third-party hosting token is needed.

The default project URL requires no custom DNS. If a custom domain is added later,
update the canonical/OG URLs, robots/sitemap, and the 404 home and stylesheet links.
Configure DNS and verify domain ownership before pointing the repository at it.

Run browser checks in desktop light/dark themes and narrow layouts; exercise
chart hover/focus, pin, metric selection, Escape, clipboard success/failure,
anchor navigation, and native FAQ disclosures. Respect reduced motion. Validate
the live page and assets after the deployment succeeds; a green build alone is
not proof that the public page rendered correctly.

## Initial verification

The initial site passed the allowlisted-artifact and internal-link checks, JavaScript
syntax validation, and the repository public-file audit. Computer Use verified the
rendered homepage in dark/light themes, persistent theme selection, 320px and 400px
CSS viewports without horizontal overflow, chart metric selection and keyboard
pinning, Escape clearing all pins, installation-command copying, and reduced motion
(the route animation computed to `none`). The illustration remains explicitly
labelled as example data rather than measured benchmark performance.

The extended tour was verified through Computer Use: switching the example run to
Tool revision and filtering failures shows exactly six attempts, matching 34/40
passes in the chart. Attempt 40 opens its matching transcript and expandable failed
checks. Escape closes the native modal. The route reference advances from Start to
Signal bridge by keyboard; the marble reference pauses and Stop removes its frame.
