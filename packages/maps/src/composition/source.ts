import type { MapAsset } from '../contract.js';

/** Exact privately built npm tarball consumed through the root lockfile. */
export const CONSUMED_FORK: Extract<MapAsset['provenance']['fork'], { usage: 'consumed' }> =
  Object.freeze({
    usage: 'consumed',
    repository: 'https://github.com/dfezzie/settlemaker.git',
    commit: 'e08ec2e09f9a15f9110a3048123a31a58d08c341',
    tree: 'dd79e4a4e7644e81e1417fb7d945ee85be58b919',
    license: 'GPL-3.0-only',
    sourceArchiveFormat: 'tar',
    sourceArchiveSha256: 'eb6a44f6b8bfa0e49cb2f27abb419a1a8766734cf95ab930f342d39c212ba5ca',
    packageSha256: 'df41ca6e340f068f68600be702a74d3db74e165a4f61727916279ccfd3785f84',
    packageIntegrity:
      'sha512-zQ+OxvqIDirZ9TqYxgaOV/Wq1aw7Q+RKeJIsM6RrPlHuiVgo8NShoqQm689XTzZ7Kx2weVe5lAbJNiU/bgh0ww==',
  });
