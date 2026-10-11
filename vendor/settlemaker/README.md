# SettleMaker source snapshot

This private build package contains the unchanged `src` tree from
[`dfezzie/settlemaker` at `e08ec2e09f9a15f9110a3048123a31a58d08c341`](https://github.com/dfezzie/settlemaker/tree/e08ec2e09f9a15f9110a3048123a31a58d08c341).
The original package manifest and lockfile are retained as `upstream-package.json`
and `upstream-package-lock.json`. The local package wrapper supplies workspace
build commands and exact runtime dependency versions; it does not change engine
source. `LICENSE`, `NOTICE` and artwork credits retain their original terms.

From the Kriegsspiel root, run `npm run setup:map-source` before `npm ci`.
Setup verifies the source payload, installs an independently locked compiler and
runtime graph, and produces the exact locally consumed npm tarball. Its SHA-256
and SHA-512 integrity are checked against `vendor/settlemaker.snapshot.json`;
the root lockfile pins that same tarball. Generated object code is ignored and
is neither committed nor published. No ignored checkout or running game is
required. Node follows `.nvmrc`.

The complete corresponding development source includes the fork's tests, scripts
and original artwork. Retrieve the immutable source independently:

```sh
git clone https://github.com/dfezzie/settlemaker.git settlemaker-source
cd settlemaker-source
git checkout --detach e08ec2e09f9a15f9110a3048123a31a58d08c341
git archive --format=tar --output=../settlemaker-source.tar HEAD
shasum -a 256 ../settlemaker-source.tar
npm ci
npm run build
SETTLEMAKER_SOURCE_REVISION=e08ec2e09f9a15f9110a3048123a31a58d08c341 npm run build:lib
```

The source archive SHA-256 is
`eb6a44f6b8bfa0e49cb2f27abb419a1a8766734cf95ab930f342d39c212ba5ca`.
This snapshot is for local development and source review. Combined Kriegsspiel
distribution remains gated by the owner's licensing decision; this workspace
does not grant a licence for the rest of Kriegsspiel.
