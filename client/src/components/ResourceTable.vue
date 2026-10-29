<script setup>
defineProps({
  columns: { type: Array, required: true },
  rows: { type: Array, default: () => [] },
  canWrite: { type: Boolean, default: false },
});
const emit = defineEmits(["edit", "delete"]);
</script>

<template>
  <table>
    <thead>
      <tr>
        <th v-for="c in columns" :key="c.key">{{ c.label }}</th>
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
