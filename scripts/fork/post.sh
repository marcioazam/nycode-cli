#!/usr/bin/env bash
set -e
cd "$1"
sed -i 's#@earendil-works#@nycode#g' apps/p2/src/source-resolver.ts apps/p2/test/p2/plugin-layout.test.ts apps/p2/test/p2/web-sources.test.ts packages/coding-agent/src/experimental/source-resolver.ts scripts/check-model-catalog-compat.mjs apps/p2-mac/scripts/package-app.sh packages/coding-agent/test/config.test.ts apps/p3/old/test/release/release.test.ts apps/p3/old/test/build-release.test.ts packages/chord/test/contracts/schema.test.ts packages/evals/docker/entrypoint.ts apps/p3/docs/testing.md packages/coding-agent/src/core/package-manager.ts apps/p3/docs/slices/26-release/walkthrough/index.html
sed -i 's#(?:badlogic|earendil-works)\\/nycode-mono#(?:badlogic|earendil-works)\\/pi-mono#' packages/coding-agent/src/utils/changelog.ts scripts/release-notes.mjs
sed -i 's#@earendil-works\\/nycode-server#@earendil-works\\/pi-server#' scripts/check-runtime-deps.test.mjs
sed -i 's#earendil-works/nycode#marcioazam/nycode#' apps/p2-mac/scripts/release-secrets.sh scripts/preview-packages.test.mjs
sed -i 's#"\[\#5167\](https://github.com/earendil-works/pi/pull/5167)"#"[\#5167](https://github.com/marcioazam/nycode/pull/5167)"#; s#"\[\#4163\](https://github.com/earendil-works/pi/issues/4163)"#"[\#4163](https://github.com/marcioazam/nycode/issues/4163)"#' packages/coding-agent/test/changelog.test.ts
python3 - <<'P'
p='.github/workflows/ci.yml'
s=open(p).read()
a=s.index("      # Previews are published"); b=s.index("      - name: Check\n")
s=s[:a]+s[b:]
s=s.replace("""    # The release commit is pushed together with the next commit, so a push to main never builds it; the tag run does,
    # and preview-packages.yml releases its packages on pkg.earendil.com.
""","""    # The release commit is pushed together with the next commit, so a push to main never builds it; the tag run does.
""")
open(p,'w').write(s)
P
sed -i 's#from marcioazam/nycode#from earendil-works/pi#' apps/p2/plugins/models/config-value.ts apps/p2/plugins/models/credentials.ts apps/p2/plugins/models/model-config.ts apps/p2/plugins/models/provider-config.ts apps/p2/plugins/prompt/context-files.ts apps/p2/plugins/prompt/templates.ts apps/p2/src/runtime/config-json.ts apps/p2/src/runtime/locked-file.ts
sed -i 's#"name": "pi-extension-#"name": "nycode-extension-#' packages/coding-agent/examples/extensions/custom-provider-anthropic/package-lock.json packages/coding-agent/examples/extensions/gondolin/package-lock.json packages/coding-agent/examples/extensions/with-deps/package-lock.json
