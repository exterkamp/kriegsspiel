<script lang="ts">
  import Shell from '../shell/Shell.svelte';
  import type {
    HqDataSource,
    HqRepository,
    MapSurface,
    PersonalMark,
    PublicArtwork,
  } from '../contracts';
  let {
    source,
    surface,
    repository,
    artwork,
  }: {
    source: HqDataSource;
    surface: MapSurface;
    repository: HqRepository;
    artwork: PublicArtwork;
  } = $props();
  let marks = $state.raw<readonly PersonalMark[]>([]);
  export function setMarks(next: readonly PersonalMark[]) {
    marks = next;
  }
</script>

<Shell {source} {surface} {repository} {artwork} {marks} />
