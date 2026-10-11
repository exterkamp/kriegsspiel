<script lang="ts">
  import Table from './Table.svelte';
  let { onAction }: { onAction: () => void } = $props();
</script>

<Table label="Harness formations; scroll for actions">
  {#snippet caption()}Supplied formation summary{/snippet}
  {#snippet header()}
    <tr><th scope="col">Formation</th><th scope="col">Strength</th><th scope="col">Action</th></tr>
  {/snippet}
  {#snippet body()}
    <tr>
      <th class="table-text" scope="row">First formation</th>
      <td class="table-value"><strong>100</strong></td>
      <td class="table-action"><button onclick={onAction}>Focus formation</button></td>
    </tr>
  {/snippet}
</Table>
