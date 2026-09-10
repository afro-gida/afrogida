#!/usr/bin/env bash
# Run on the VPS as the 'ubuntu' user. Generates a read-only GitHub deploy key
# and an ssh alias for it. Idempotent. Prints the public key at the end.
set -euo pipefail

mkdir -p ~/.ssh
chmod 700 ~/.ssh

if [ ! -f ~/.ssh/afrogida_deploy ]; then
    ssh-keygen -t ed25519 -N '' -f ~/.ssh/afrogida_deploy -C 'afrogida-deploy@vps' -q
    echo "generated ~/.ssh/afrogida_deploy"
else
    echo "key already exists, reusing"
fi
chmod 600 ~/.ssh/afrogida_deploy

if ! ssh-keygen -F github.com >/dev/null 2>&1; then
    ssh-keyscan -t rsa,ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null
    echo "added github.com to known_hosts"
fi

if ! grep -q 'Host github-afrogida' ~/.ssh/config 2>/dev/null; then
    printf '\nHost github-afrogida\n    HostName github.com\n    User git\n    IdentityFile ~/.ssh/afrogida_deploy\n    IdentitiesOnly yes\n' >> ~/.ssh/config
    chmod 600 ~/.ssh/config
    echo "added github-afrogida ssh alias"
fi

echo
echo "=== DEPLOY PUBLIC KEY — add at GitHub > repo > Settings > Deploy keys (leave 'Allow write access' UNCHECKED) ==="
cat ~/.ssh/afrogida_deploy.pub
