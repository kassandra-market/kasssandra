# Kassandra documentation site

The [Kassandra](https://github.com/Dodecahedr0x/kassandra) documentation, built with
[Mintlify](https://mintlify.com). Content lives in this directory as MDX; the site
configuration is `docs.json`.

## Develop locally

```bash
# from docs-site/
npm install            # installs the `mint` CLI locally
npm run dev            # serves the docs at http://localhost:3000

# or, without installing:
npx mint dev
```

## Validate

```bash
npm run check-links    # runs `mint broken-links`
```

The same check runs in CI on every push to `master` and on pull requests
(`.github/workflows/docs.yml`).

## How publishing works

Mintlify hosts the docs. Publishing is performed by the **Mintlify GitHub App**, which
auto-deploys this `docs-site/` project on every push to the `master` branch. The GitHub
Actions workflow validates the config and links so a broken commit never reaches the live
site.

### One-time setup (done once by a maintainer)

1. Sign in at <https://dashboard.mintlify.com> with GitHub.
2. Connect the `Dodecahedr0x/kassandra` repository.
3. Set the **content directory** to `docs-site` and the **deployment branch** to `master`.
4. Install the **Mintlify GitHub App** when prompted.

After that, every push to `master` auto-deploys, gated by the CI workflow. See the
[Operations → The docs site](https://github.com/Dodecahedr0x/kassandra) page for details.

## Structure

- `docs.json` — site config: theme, colors, navigation (tabs → groups → pages).
- `guide/`, `concepts/`, `architecture/`, `app/`, `ops/`, `contributing/` — the
  Documentation tab.
- `protocol/`, `challenge/`, `sdk/` — the Reference tab.
