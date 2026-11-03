<script setup>
import { computed } from "vue";

// A unit's availability state. Colour is never the only signal: the label is
// always printed, and the dot adds a second cue. Text stays on --text over a
// tinted fill so contrast holds in both the light and the dark theme.
const props = defineProps({
  status: { type: String, default: "" },
});

const LABELS = {
  VACANT: "Vacant",
  BLOCKED: "Blocked",
  OCCUPIED: "Occupied",
  UNAVAILABLE: "Unavailable",
};

const label = computed(() => LABELS[props.status] || props.status || "—");
const tone = computed(() => (LABELS[props.status] ? props.status.toLowerCase() : "unknown"));
</script>

<template>
  <span class="unit-status" :class="`unit-status--${tone}`" :data-status="status">
    <span class="unit-status__dot" aria-hidden="true"></span>{{ label }}
  </span>
</template>

<style scoped>
.unit-status {
  display: inline-flex; align-items: center; gap: 0.4rem;
  font-size: 0.72rem; font-weight: 650; line-height: 1;
  padding: 0.28rem 0.6rem; border-radius: 999px; white-space: nowrap;
  color: var(--text); background: var(--paper);
  border: 1px solid var(--line-strong);
}
.unit-status__dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--faint); flex: none; }

/* Vacant — green: ready to lease. */
.unit-status--vacant { background: var(--good-050); border-color: var(--good); }
.unit-status--vacant .unit-status__dot { background: var(--good); }

/* Blocked — amber: held for a prospect's deal. */
.unit-status--blocked { background: var(--warn-050); border-color: var(--warn); }
.unit-status--blocked .unit-status__dot { background: var(--warn); }

/* Occupied — the brand accent: in use. */
.unit-status--occupied { background: var(--accent-050); border-color: var(--accent); }
.unit-status--occupied .unit-status__dot { background: var(--accent); }

/* Unavailable — neutral grey: taken off the market by staff. */
.unit-status--unavailable { background: var(--thead-bg); border-color: var(--line-strong); color: var(--muted); }
.unit-status--unavailable .unit-status__dot { background: var(--faint); }
</style>
