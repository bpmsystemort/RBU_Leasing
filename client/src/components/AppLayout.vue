<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth.js";
import { useActionCenter } from "../stores/actionCenter.js";
import { roleLabel } from "../lib/formatters.js";
import AppIcon from "./AppIcon.vue";
import ThemeToggle from "./ThemeToggle.vue";
import PageFormPanel from "./PageFormPanel.vue";
import { slotForPath } from "../../../shared/pageForms.js";
import logoUrl from "../assets/ortigas-logo.svg";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

// Light/dark is chosen in ThemeToggle, mounted at the app root so the control
// is in the same place on every page (public routes included).

// --- Outstanding work needing a decision ---------------------------------
// Polled centrally here rather than per-page, so a waiting approval is visible
// from anywhere in the app. Only roles that can act on it poll at all.
const actions = useActionCenter();
const canAct = computed(() => ["ADMIN", "LEASING_OFFICER"].includes(auth.role));
const actionsOpen = ref(false);

onMounted(() => { if (canAct.value) actions.start(auth.role); });
onBeforeUnmount(() => actions.stop());

// Badge text, capped so a large number cannot stretch the sidebar or the bell.
function badge(n) { return n > 99 ? "99+" : String(n); }

// Count for a given nav destination — extend as more action types appear.
function pendingFor(to) {
  return to === "/app/account-approvals" ? actions.accountApprovals : 0;
}

const bellLabel = computed(() =>
  actions.total > 0 ? `${actions.total} action${actions.total === 1 ? "" : "s"} needed` : "No actions needed");

// --- Sidebar + user menu state ---
const isNarrow = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(max-width: 860px)").matches : false;
const sidebarOpen = ref(!isNarrow);
const menuOpen = ref(false);

// Grouped navigation. `admin` = Super Admin only, `write` = write staff.
const STAFF_GROUPS = [
  { label: "Workspace", items: [
    { to: "/app", label: "Dashboard", icon: "grid" },
    { to: "/app/inquiries", label: "Inquiries", icon: "message" },
    { to: "/app/transactions", label: "Leasing Tracker", icon: "activity" },
    { to: "/app/owners", label: "Owners", icon: "users" },
    { to: "/app/units", label: "Units", icon: "building" },
    { to: "/app/tenants", label: "Tenants", icon: "user" },
    { to: "/app/leases", label: "Leases", icon: "file" },
    { to: "/app/approvals", label: "Approvals", icon: "check", write: true },
    { to: "/app/lessor-sheets", label: "Lessor Sheets", icon: "clipboard", write: true },
    { to: "/app/lessee-sheets", label: "Lessee Sheets", icon: "clipboard", write: true },
    { to: "/app/requirements", label: "Requirements", icon: "folder", write: true },
  ] },
  { label: "Administration", items: [
    { to: "/app/account-approvals", label: "Account Approvals", icon: "shield", write: true },
    { to: "/app/content", label: "Content Manager", icon: "columns", write: true },
    { to: "/app/users", label: "System Users", icon: "shield", admin: true },
    { to: "/app/audit", label: "Audit Trail", icon: "list", admin: true },
    { to: "/app/import", label: "Import Portfolio", icon: "download", admin: true },
  ] },
];
const OWNER_GROUPS = [{ label: null, items: [
  { to: "/app/my-units", label: "My Units", icon: "building" },
  { to: "/app/leasing-progress", label: "Leasing Progress", icon: "activity" },
  { to: "/app/info-sheet", label: "Acceptance Form", icon: "clipboard" },
  { to: "/app/lessor-requirements", label: "Requirements", icon: "folder" },
  { to: "/app/my-leases", label: "My Leases", icon: "file" },
  { to: "/app/my-profile", label: "My Profile", icon: "user" },
] }];
const TENANT_GROUPS = [{ label: null, items: [
  { to: "/app/my-lease", label: "My Lease", icon: "file" },
  { to: "/app/browse-units", label: "Available Units", icon: "building" },
  { to: "/app/leasing-progress", label: "Leasing Progress", icon: "activity" },
  { to: "/app/info-sheet-tenant", label: "Acceptance Form", icon: "clipboard" },
  { to: "/app/requirements", label: "Requirements", icon: "folder" },
  { to: "/app/my-profile", label: "My Profile", icon: "user" },
] }];

const groups = computed(() => {
  const base = auth.isOwner ? OWNER_GROUPS : auth.isTenant ? TENANT_GROUPS : STAFF_GROUPS;
  return base
    .map((g) => ({ label: g.label, items: g.items.filter((i) => (i.admin ? auth.role === "ADMIN" : i.write ? auth.canWrite : true)) }))
    .filter((g) => g.items.length);
});
const allItems = computed(() => groups.value.flatMap((g) => g.items));

function isActive(to) {
  return to === "/app" ? route.path === "/app" : route.path.startsWith(to);
}
const currentLabel = computed(() => {
  const match = allItems.value.find((i) => isActive(i.to));
  return match ? match.label : "";
});

// The admin-configured custom-field slot for the current role + page (if any).
// Rendered centrally so every navigation destination can carry extra fields.
const activeSlot = computed(() => (auth.role ? slotForPath(auth.role, route.path) : undefined));

// Lessor, Lessee, and O-Lease (Leasing Officer) all brand as the "Ortigas Land
// Leasing Portal"; only back-office admins/viewers see "RBU Leasing / Back Office".
const isPortal = computed(() => auth.isOwner || auth.isTenant || auth.role === "LEASING_OFFICER");
const brandName = computed(() => (isPortal.value ? "Ortigas Land" : "RBU Leasing"));
const brandSub = computed(() => (isPortal.value ? "Leasing Portal" : "Back Office"));

const initials = computed(() => {
  const n = auth.user?.name || auth.user?.email || "U";
  return n.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
});

function onNav() {
  menuOpen.value = false;
  if (window.matchMedia && window.matchMedia("(max-width: 860px)").matches) sidebarOpen.value = false;
}
function logout() {
  // Cleared here rather than inside the auth store: actionCenter -> resource ->
  // api -> auth would be a circular import, and both stores are already in
  // scope in this component.
  actions.reset();
  auth.logout();
  router.push("/");
}
</script>

<template>
  <div class="shell" :class="{ 'sidebar-collapsed': !sidebarOpen }">
    <div v-if="sidebarOpen" class="scrim" @click="sidebarOpen = false"></div>

    <aside class="sidebar">
      <div class="sidebar__brand">
        <button
          type="button" class="sidebar__mark"
          @click="sidebarOpen = !sidebarOpen"
          :aria-label="sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'"
          :title="sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'"
        >
          <img :src="logoUrl" class="sidebar__mark-logo" alt="Ortigas Land" />
          <AppIcon name="chevron" :size="15" class="sidebar__mark-expand" />
        </button>
        <div v-if="sidebarOpen" class="sidebar__brandtext">
          <span class="sidebar__name">{{ brandName }}</span>
          <span class="sidebar__sub">{{ brandSub }}</span>
        </div>
        <button
          v-if="sidebarOpen" type="button" class="sidebar__collapse"
          @click="sidebarOpen = false" aria-label="Collapse sidebar" title="Collapse sidebar"
        >
          <AppIcon name="chevron" :size="16" />
        </button>
      </div>

      <nav class="sidebar__nav">
        <div v-for="(g, gi) in groups" :key="gi" class="navgroup">
          <p v-if="g.label && sidebarOpen" class="navgroup__label">{{ g.label }}</p>
          <div v-else-if="g.label && gi > 0" class="navgroup__rule"></div>
          <RouterLink
            v-for="l in g.items" :key="l.to" :to="l.to"
            class="navlink" :class="{ active: isActive(l.to) }"
            :title="!sidebarOpen ? l.label : undefined" @click="onNav"
          >
            <span class="navlink__icon"><AppIcon :name="l.icon" :size="18" /></span>
            <span v-if="sidebarOpen" class="navlink__label">{{ l.label }}</span>
            <span
              v-if="canAct && pendingFor(l.to) > 0"
              class="navlink__badge"
              :title="`${pendingFor(l.to)} awaiting action`"
            >{{ badge(pendingFor(l.to)) }}</span>
          </RouterLink>
        </div>
      </nav>
    </aside>

    <div class="content">
      <header class="topbar">
        <button type="button" class="topbar__menu" @click="sidebarOpen = !sidebarOpen" aria-label="Toggle navigation">
          <AppIcon name="menu" :size="20" />
        </button>
        <div class="crumbs">
          <span class="crumbs__root">{{ brandName }}</span>
          <AppIcon name="chevron" :size="13" class="crumbs__sep" />
          <span class="crumbs__here">{{ currentLabel }}</span>
        </div>

        <div class="topbar__right">
          <div v-if="canAct" class="bellwrap">
            <button
              type="button"
              class="bell"
              :class="{ 'has-actions': actions.hasActions }"
              :aria-label="bellLabel"
              aria-haspopup="menu"
              :aria-expanded="actionsOpen"
              @click="actionsOpen = !actionsOpen"
            >
              <AppIcon name="bell" :size="18" />
              <span v-if="actions.total > 0" class="bell__count">{{ badge(actions.total) }}</span>
            </button>
            <div class="actions-panel" v-show="actionsOpen" role="menu">
              <div class="actions-panel__head">Actions needed</div>
              <RouterLink
                v-if="actions.accountApprovals > 0"
                class="actions-panel__item"
                to="/app/account-approvals"
                @click="actionsOpen = false"
              >
                <span class="actions-panel__n">{{ badge(actions.accountApprovals) }}</span>
                <span>
                  <strong>Account Approvals</strong>
                  <small>Lessor/lessee sign-ups waiting for a decision</small>
                </span>
              </RouterLink>
              <p v-else class="actions-panel__empty">Nothing needs your attention.</p>
            </div>
            <div v-show="actionsOpen" class="menu-scrim" @click="actionsOpen = false"></div>
          </div>
          <ThemeToggle inline />
          <div class="usermenu">
            <button type="button" class="userchip" :class="{ open: menuOpen }" @click="menuOpen = !menuOpen" aria-haspopup="menu" :aria-expanded="menuOpen">
              <span class="userchip__avatar">{{ initials }}</span>
              <span class="userchip__meta">
                <span class="userchip__name">{{ auth.user?.name || auth.user?.email }}</span>
                <span v-if="auth.role" class="userchip__role">{{ roleLabel(auth.role) }}</span>
              </span>
              <AppIcon name="chevron-down" :size="15" class="userchip__caret" />
            </button>
            <div class="menu" v-show="menuOpen" role="menu">
              <div class="menu__head">
                <span class="userchip__avatar lg">{{ initials }}</span>
                <div>
                  <div class="menu__name">{{ auth.user?.name || auth.user?.email }}</div>
                  <div class="menu__email">{{ auth.user?.email }}</div>
                  <span v-if="auth.role" class="menu__role">{{ roleLabel(auth.role) }}</span>
                </div>
              </div>
              <button type="button" class="menu__item logout" @click="logout">
                <AppIcon name="logout" :size="15" /> Log out
              </button>
            </div>
            <div v-show="menuOpen" class="menu-scrim" @click="menuOpen = false"></div>
          </div>
        </div>
      </header>

      <main class="app-main">
        <RouterView v-slot="{ Component }">
          <transition name="view" mode="out-in">
            <component :is="Component" />
          </transition>
        </RouterView>
        <PageFormPanel v-if="activeSlot" :key="`${auth.role}:${activeSlot.key}`" :page-key="activeSlot.key" />
      </main>
    </div>
  </div>
</template>
