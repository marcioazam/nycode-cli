set -e
cd /tmp/nycode-remove-all
git reset -q --hard HEAD
git rm -q -r .github/workflows/{approve-contributor,build-binaries,env-daemons,env,issue-analysis,issue-gate,issue-triage-labels,nix,p2-cloud-bundle,p2-mac-nightly,pr-gate,preview-packages,publish-model-catalog,remove-labels-on-close}.yml
python3 /tmp/nycode-rename/rename.py . | head -1
bash /tmp/nycode-rename/post.sh .
npm install --package-lock-only --ignore-scripts > /tmp/nycode-rename/lock.log 2>&1
node scripts/generate-coding-agent-install-lock.mjs
npm ci --ignore-scripts > /tmp/nycode-rename/ci2.log 2>&1
systemd-run --user --scope --slice=build.slice --quiet --collect -- npm run build > /tmp/nycode-rename/build2.log 2>&1
