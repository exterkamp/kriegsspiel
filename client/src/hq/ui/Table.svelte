<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    caption,
    header,
    body,
  }: {
    label: string;
    caption: Snippet;
    header: Snippet;
    body: Snippet;
  } = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard focus lets readers scroll to every column and action.) -->
<div class="table-scroll" role="region" aria-label={label} tabindex="0">
  <table>
    <caption>{@render caption()}</caption>
    <thead>{@render header()}</thead>
    <tbody>{@render body()}</tbody>
  </table>
</div>

<style>
  .table-scroll {
    min-inline-size: 0;
    max-inline-size: 100%;
    overflow-x: auto;
    margin-block: 1rem;
  }
  table {
    inline-size: 100%;
    min-inline-size: 56rem;
    table-layout: auto;
    border-collapse: collapse;
    text-align: left;
    font-size: 1rem;
    overflow-wrap: normal;
    word-break: normal;
  }
  caption {
    text-align: left;
    margin-block-end: 0.6rem;
    overflow-wrap: normal;
  }
  .table-scroll :global(th),
  .table-scroll :global(td) {
    vertical-align: top;
    border-block-end: 1px solid currentColor;
    padding: 0.5rem;
    overflow-wrap: normal;
    word-break: normal;
  }
  .table-scroll :global(thead th) {
    white-space: nowrap;
  }
  .table-scroll :global(.table-text),
  .table-scroll :global(.table-action),
  .table-scroll :global(small) {
    white-space: normal;
    overflow-wrap: normal;
    word-break: normal;
  }
  .table-scroll :global(.table-value strong) {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .table-scroll:focus-visible {
    outline: 3px solid currentColor;
    outline-offset: 3px;
  }
</style>
