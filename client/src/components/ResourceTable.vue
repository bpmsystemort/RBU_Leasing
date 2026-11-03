<script setup>
const props = defineProps({
  columns: { type: Array, required: true },
  rows: { type: Array, default: () => [] },
  canWrite: { type: Boolean, default: false },
  // Optional sorting: a column opts in with `sortable: true`; the parent owns
  // the sort state and answers the "sort" event. Unused by other screens.
  sortKey: { type: String, default: "" },
  sortDir: { type: String, default: "asc" },
});
const emit = defineEmits(["edit", "delete", "sort"]);

function ariaSort(c) {
  if (!c.sortable) return undefined;
  if (props.sortKey !== c.key) return "none";
  return props.sortDir === "desc" ? "descending" : "ascending";
}
</script>

<template>
  <table>
    <thead>
      <tr>
        <th v-for="c in columns" :key="c.key" :aria-sort="ariaSort(c)">
          <button v-if="c.sortable" type="button" class="th-sort" @click="emit('sort', c.key)">
            {{ c.label }}<span v-if="sortKey === c.key" class="sort-arrow" aria-hidden="true">{{ sortDir === "desc" ? "▼" : "▲" }}</span>
          </button>
          <template v-else>{{ c.label }}</template>
        </th>
        <th v-if="canWrite">Actions</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in rows" :key="row.id">
        <td v-for="c in columns" :key="c.key">
          <slot :name="`cell-${c.key}`" :row="row">
            {{ c.format ? c.format(row[c.key]) : row[c.key] }}
          </slot>
        </td>
        <td v-if="canWrite">
          <button type="button" class="edit" @click="emit('edit', row)">Edit</button>
          <button type="button" class="delete" @click="emit('delete', row)">Delete</button>
        </td>
      </tr>
      <tr v-if="rows.length === 0">
        <td :colspan="canWrite ? columns.length + 1 : columns.length">No records.</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
/* Sortable header: reads as the header text, not as a table action button. */
.th-sort {
  background: none; border: none; box-shadow: none; margin: 0; padding: 0;
  font: inherit; letter-spacing: inherit; text-transform: inherit; color: inherit;
  cursor: pointer; display: inline-flex; align-items: center; gap: 0.3rem;
}
.th-sort:hover, .th-sort:active { background: none; color: var(--text); transform: none; }
.sort-arrow { font-size: 0.6rem; color: var(--accent-text); }
</style>
