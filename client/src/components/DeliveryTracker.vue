<script setup>
// Parcel-delivery–style leasing tracker: a "tracking number" hero with the
// current courier-like state and a segmented progress bar, above a vertical
// milestone timeline (checked / in-progress / upcoming) with timestamps.
import { computed } from "vue";
import { LEASING_STAGES, stageIndex } from "../../../shared/leasingStages.js";

const props = defineProps({
  reference: { type: String, default: "" },
  currentStage: { type: String, required: true },
  status: { type: String, default: "" },
  finalStatus: { type: String, default: null },
  stageData: { type: Object, default: () => ({}) },
  note: { type: String, default: "" },        // remark for the current stage
  showHero: { type: Boolean, default: true },
});

const STAGE_ICON = {
  INQUIRY: "📝", UNIT_VIEWING: "🏠", SEND_REQUIREMENTS: "📎", APPROVAL: "✅",
  UNIT_INSPECTION: "🔍", PHOTOSHOOT: "📸", CONTRACT_SIGNING: "✍️",
};
const TOTAL = LEASING_STAGES.length;
const currentIdx = computed(() => Math.max(0, stageIndex(props.currentStage)));
// "Delivered" means the transaction is on the last stage and that stage's
// `done` status has been reached — derived so a newly appended terminal
// stage (e.g. Contract Signing) doesn't need this hardcoded.
const finalStage = LEASING_STAGES[LEASING_STAGES.length - 1];
const isDelivered = computed(() => props.currentStage === finalStage.key && (props.finalStatus || props.status) === finalStage.done);

// Courier-style headline + sub-line.
const state = computed(() => {
  if (isDelivered.value) return { label: props.finalStatus || props.status, tone: "delivered" };
  if (["Rejected", "Cancelled", "Declined", "Expired"].includes(props.status)) return { label: props.status, tone: "stopped" };
  return { label: "In Progress", tone: "transit" };
});
const progressPct = computed(() => (isDelivered.value ? 100 : (currentIdx.value / (TOTAL - 1)) * 100));

function fmt(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const milestones = computed(() =>
  LEASING_STAGES.map((s, i) => {
    const sd = props.stageData?.[s.key] || {};
    const stateName = i < currentIdx.value ? "done" : i === currentIdx.value ? "current" : "upcoming";
    return {
      key: s.key, label: s.label, short: s.short, icon: STAGE_ICON[s.key] || "•", n: i + 1,
      state: stateName,
      status: sd.status || (stateName === "done" ? "Done" : ""),
      time: stateName === "done" ? fmt(sd.completedAt || sd.startedAt) : stateName === "current" ? fmt(sd.startedAt) : "",
      desc: s.lesseeAction || "",
    };
  }),
);
const currentMilestone = computed(() => milestones.value[currentIdx.value]);
const firstKey = LEASING_STAGES[0].key;
const startedAt = computed(() => fmt(props.stageData?.INQUIRY?.completedAt || props.stageData?.[firstKey]?.startedAt));
</script>

<template>
  <div class="dtrack">
    <div v-if="showHero" class="hero" :class="state.tone">
      <div class="hero__row">
        <div class="hero__left">
          <span class="hero__eyebrow">Tracking No.</span>
          <span class="hero__ref">{{ reference || "—" }}</span>
        </div>
        <span class="hero__state" :class="state.tone">
          <span class="hero__pulse" aria-hidden="true"></span>{{ state.label }}
        </span>
      </div>
      <div class="hero__state-line">
        <strong>{{ milestones[currentIdx].label }}</strong>
        <span v-if="status"> · {{ status }}</span>
      </div>
      <div class="bar" role="progressbar" :aria-valuenow="Math.round(progressPct)">
        <span v-for="(m, i) in milestones" :key="m.key" class="bar__seg" :class="{ on: i <= currentIdx || isDelivered }"></span>
      </div>
      <div class="hero__meta">
        <span>Step {{ isDelivered ? TOTAL : currentIdx + 1 }} of {{ TOTAL }}</span>
        <span v-if="startedAt">Started {{ startedAt }}</span>
      </div>
    </div>

    <div class="strip">
      <ol class="track" :style="{ '--pct': progressPct + '%' }">
        <span class="track__rail" aria-hidden="true"><span class="track__fill"></span></span>
        <li v-for="m in milestones" :key="m.key" class="ms" :class="m.state" :style="{ '--i': m.n }" :title="`${m.label}${m.status ? ' — ' + m.status : ''}`">
          <span class="ms__node">
            <svg v-if="m.state === 'done'" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            <span v-else class="ms__icon">{{ m.icon }}</span>
          </span>
          <span class="ms__label">{{ m.short }}</span>
          <span v-if="m.status" class="ms__status">{{ m.status }}</span>
          <span v-if="m.time" class="ms__time">{{ m.time }}</span>
        </li>
      </ol>
    </div>

    <div v-if="currentMilestone" class="now">
      <span class="now__icon">{{ currentMilestone.icon }}</span>
      <div class="now__body">
        <div class="now__top">
          <span class="now__label">{{ currentMilestone.label }}</span>
          <span class="now__pill"><span class="now__dot"></span>{{ isDelivered ? "Complete" : "In progress" }}</span>
        </div>
        <div v-if="currentMilestone.desc" class="now__desc">{{ currentMilestone.desc }}</div>
        <div v-if="note" class="now__note">{{ note }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dtrack { width: 100%; }

/* ---- hero ---- */
.hero {
  position: relative; overflow: hidden; border-radius: var(--radius); padding: 1.3rem 1.4rem;
  /* Same dark ground as the navigation, so the tracker reads as part of the
     system rather than a leftover from an earlier palette. */
  /* A flat brand slab. This was a three-stop radial gradient in the old
     palette; the theme brief rules gradients out, and a solid fill is what
     makes the white type on it a predictable contrast rather than one that
     varies across the block. */
  color: var(--on-accent); background: var(--accent);
  box-shadow: var(--shadow-md); margin-bottom: 1.25rem;
}
/* Completed reads as success rather than brand — the one place a second green
   is meaningful, and it comes from the status token, not a new colour. */
.hero.delivered { background: var(--good); color: #FFFFFF; }
.hero.stopped { background: radial-gradient(120% 140% at 100% 0%, #7a3a34 0%, #3a1a17 70%); }
.hero__row { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.hero__left { display: flex; flex-direction: column; gap: 0.15rem; }
.hero__eyebrow { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.2em; color: var(--chrome-muted); font-weight: 700; }
.hero__ref { font-family: ui-monospace, "Consolas", monospace; font-size: 1.15rem; font-weight: 600; color: #fff; letter-spacing: 0.01em; }
.hero__state {
  display: inline-flex; align-items: center; gap: 0.45rem; flex-shrink: 0;
  background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); border-radius: 999px;
  padding: 0.32rem 0.8rem; font-size: 0.8rem; font-weight: 700; white-space: nowrap;
}
.hero__pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--chrome-muted); box-shadow: 0 0 0 0 rgba(147, 177, 166, 0.7); animation: pulse 1.8s infinite; }
.hero__state.delivered .hero__pulse { background: #7dffc0; animation: none; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(143,211,176,0.6); } 70% { box-shadow: 0 0 0 8px rgba(143,211,176,0); } 100% { box-shadow: 0 0 0 0 rgba(143,211,176,0); } }
.hero__state-line { margin-top: 0.9rem; font-size: 1.05rem; color: rgba(234,243,238,0.92); }
.hero__state-line strong { color: #fff; font-weight: 600; }

.bar { display: flex; gap: 4px; margin: 1rem 0 0.6rem; }
.bar__seg { flex: 1; height: 6px; border-radius: 999px; background: rgba(255,255,255,0.16); transition: background 0.5s var(--ease-out, ease); }
.bar__seg.on { background: var(--chrome-muted); }
.hero__meta { display: flex; justify-content: space-between; font-size: 0.75rem; color: rgba(234,243,238,0.66); }

/* ---- horizontal milestone strip ---- */
.strip { overflow-x: auto; padding: 0.25rem 0.25rem 0.5rem; scrollbar-width: thin; }
.track { position: relative; list-style: none; margin: 0; padding: 0; display: flex; min-width: 760px; }
.track__rail { position: absolute; left: 0; right: 0; top: 18px; height: 3px; background: var(--line-strong); border-radius: 999px; margin: 0 5%; }
.track__fill { display: block; height: 100%; width: var(--pct, 0%); background: linear-gradient(90deg, var(--accent), var(--accent-600)); border-radius: 999px; transition: width 0.6s var(--ease-out, ease); }
.ms { position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.35rem; padding: 0 0.25rem; }
.ms__node {
  position: relative; z-index: 1; width: 38px; height: 38px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center; font-size: 1.05rem;
  background: var(--surface); border: 2px solid var(--line-strong); color: var(--muted);
  transition: transform 0.2s var(--ease-spring, ease), border-color 0.2s, background 0.2s, box-shadow 0.2s;
}
.ms.done .ms__node { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.ms.current .ms__node { border-color: var(--accent); background: var(--accent-050); transform: scale(1.14); box-shadow: 0 0 0 5px var(--accent-050); }
.ms.current .ms__node::after { content: ""; position: absolute; inset: -2px; border-radius: 50%; border: 2px solid var(--accent); animation: ring 1.8s ease-out infinite; }
@keyframes ring { 0% { transform: scale(1); opacity: 0.7; } 100% { transform: scale(1.5); opacity: 0; } }
.ms.upcoming .ms__node { filter: grayscale(0.5); opacity: 0.6; }
.ms__label { font-size: 0.72rem; font-weight: 600; color: var(--muted); line-height: 1.15; max-width: 9ch; }
.ms.done .ms__label, .ms.current .ms__label { color: var(--text); }
.ms.current .ms__label { color: var(--accent-text); font-weight: 700; }
.ms__status { font-size: 0.66rem; color: var(--accent-text); font-weight: 600; background: var(--accent-050); border-radius: 999px; padding: 0.05rem 0.4rem; max-width: 12ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ms.upcoming .ms__status { color: var(--muted); background: var(--paper); }
.ms__time { font-size: 0.64rem; color: var(--faint); }

@media (prefers-reduced-motion: no-preference) {
  .ms { animation: ms-in 0.4s var(--ease-out, ease) both; animation-delay: calc(var(--i) * 40ms); }
}
@keyframes ms-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

/* ---- current-step detail card (below the strip) ---- */
.now { display: flex; gap: 0.85rem; align-items: flex-start; margin-top: 1rem; padding: 0.9rem 1rem; background: var(--accent-050); border: 1px solid var(--accent-100, transparent); border-radius: var(--radius); }
.now__icon { font-size: 1.5rem; line-height: 1; flex-shrink: 0; }
.now__body { flex: 1; min-width: 0; }
.now__top { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.now__label { font-weight: 700; color: var(--accent-text); font-size: 1rem; }
.now__pill { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.66rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent-text); background: var(--surface); border-radius: 999px; padding: 0.12rem 0.5rem; }
.now__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: pulse 1.8s infinite; }
.now__desc { font-size: 0.9rem; color: var(--text); margin-top: 0.3rem; line-height: 1.45; }
.now__note { font-size: 0.85rem; color: var(--muted); background: var(--surface); border-radius: var(--radius-sm); padding: 0.5rem 0.65rem; margin-top: 0.5rem; }
</style>
