import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth.js";
import AppLayout from "../components/AppLayout.vue";
import InquiryView from "../views/InquiryView.vue";
import LandingView from "../views/LandingView.vue";
import AvailableUnitsView from "../views/AvailableUnitsView.vue";
import UnitDetailPublicView from "../views/UnitDetailPublicView.vue";
import LoginView from "../views/LoginView.vue";
import SignupView from "../views/SignupView.vue";
import RegisterUnitPublicView from "../views/RegisterUnitPublicView.vue";
import ExecutiveDashboardView from "../views/ExecutiveDashboardView.vue";
import DashboardMetricView from "../views/DashboardMetricView.vue";
import BrowseUnitsView from "../views/BrowseUnitsView.vue";
import InquiriesView from "../views/InquiriesView.vue";
import OwnersView from "../views/OwnersView.vue";
import OwnerFormView from "../views/OwnerFormView.vue";
import TenantsView from "../views/TenantsView.vue";
import TenantFormView from "../views/TenantFormView.vue";
import UnitsView from "../views/UnitsView.vue";
import UnitFormView from "../views/UnitFormView.vue";
import UnitListingView from "../views/UnitListingView.vue";
import LeasesView from "../views/LeasesView.vue";
import LeaseFormView from "../views/LeaseFormView.vue";
import MyUnitsView from "../views/MyUnitsView.vue";
import RegisterUnitView from "../views/RegisterUnitView.vue";
import OwnerLeasesView from "../views/OwnerLeasesView.vue";
import MyProfileView from "../views/MyProfileView.vue";
import TenantLeaseView from "../views/TenantLeaseView.vue";
import ApprovalsView from "../views/ApprovalsView.vue";
import LessorInfoSheetsView from "../views/LessorInfoSheetsView.vue";
import LesseeInfoSheetsView from "../views/LesseeInfoSheetsView.vue";
import MyLessorRequirementsView from "../views/MyLessorRequirementsView.vue";
import LessorProfileView from "../views/LessorProfileView.vue";
import ApplicationStatusView from "../views/ApplicationStatusView.vue";
import PortfolioImportView from "../views/PortfolioImportView.vue";
// Lazy-loaded: pull in the PDF.js live preview, keeping it out of the main bundle.
const OwnerInfoSheetView = () => import("../views/OwnerInfoSheetView.vue");
const TenantInfoSheetView = () => import("../views/TenantInfoSheetView.vue");
import RequirementsView from "../views/RequirementsView.vue";
import UsersView from "../views/UsersView.vue";
import AccountApprovalsView from "../views/AccountApprovalsView.vue";
import AuditView from "../views/AuditView.vue";
import CmsFormsView from "../views/CmsFormsView.vue";
import ContentManagerView from "../views/ContentManagerView.vue";
import ListingsManagerView from "../views/ListingsManagerView.vue";
const CmsFormBuilderView = () => import("../views/CmsFormBuilderView.vue");
import TransactionsView from "../views/TransactionsView.vue";
const TransactionDetailView = () => import("../views/TransactionDetailView.vue");
import MyLeasingProgressView from "../views/MyLeasingProgressView.vue";

const STAFF = ["ADMIN", "LEASING_OFFICER", "VIEWER"];
const WRITE = ["ADMIN", "LEASING_OFFICER"];
const ADMIN = ["ADMIN"];

const routes = [
  { path: "/", component: LandingView, meta: { ownsThemeToggle: true } }, // public landing: role-selection entry point
  { path: "/available-units", component: AvailableUnitsView, meta: { ownsThemeToggle: true } }, // public browse page (lessee "Get Started")
  { path: "/inquiry", component: InquiryView, meta: { ownsThemeToggle: true } }, // Quick Inquiry form (user type via ?as=)
  { path: "/inquire", redirect: "/inquiry" }, // old "I am a…" picker — the landing page and the form itself now own the role question
  { path: "/units-for-lease", redirect: "/available-units" }, // legacy list path → browse page
  { path: "/units-for-lease/:id", component: UnitDetailPublicView, meta: { ownsThemeToggle: true } },
  { path: "/login", component: LoginView, meta: { ownsThemeToggle: true } },
  {
    path: "/signup",
    component: SignupView,
    meta: { ownsThemeToggle: true },
    // The lessor path now starts with the unit, not the account.
    beforeEnter: (to) => (to.query.as === "LESSOR" ? "/register-unit" : true),
  }, // public self-registration (lessee); lessor entry redirects to the unit-first wizard
  { path: "/register-unit", component: RegisterUnitPublicView, meta: { ownsThemeToggle: true } }, // public lessor wizard: unit first, then account
  {
    path: "/app",
    component: AppLayout,
    meta: { requiresAuth: true },
    children: [
      // Reachable by a non-approved account, and the only thing it can reach.
      { path: "application", component: ApplicationStatusView, meta: { roles: ["UNIT_OWNER", "TENANT"], allowPending: true } },
      // Staff
      { path: "", component: ExecutiveDashboardView, meta: { roles: STAFF } },
      // The page behind a dashboard tile: the same figure, itemised.
      { path: "metrics/:key", component: DashboardMetricView, meta: { roles: STAFF } },
      { path: "inquiries", component: InquiriesView, meta: { roles: STAFF } },
      { path: "transactions", component: TransactionsView, meta: { roles: STAFF } },
      { path: "transactions/:id", component: TransactionDetailView, meta: { roles: STAFF } },
      { path: "owners", component: OwnersView, meta: { roles: STAFF } },
      { path: "lessor-profile/:id", component: LessorProfileView, meta: { roles: STAFF } },
      { path: "owners/new", component: OwnerFormView, meta: { roles: ADMIN } },
      { path: "owners/:id", component: OwnerFormView, meta: { roles: ADMIN } },
      { path: "tenants", component: TenantsView, meta: { roles: STAFF } },
      { path: "tenants/new", component: TenantFormView, meta: { roles: ADMIN } },
      { path: "tenants/:id", component: TenantFormView, meta: { roles: ADMIN } },
      { path: "units", component: UnitsView, meta: { roles: STAFF } },
      { path: "units/new", component: UnitFormView, meta: { roles: ADMIN } },
      { path: "units/:id", component: UnitFormView, meta: { roles: ADMIN } },
      { path: "units/:id/listing", component: UnitListingView, meta: { roles: WRITE } },
      { path: "leases", component: LeasesView, meta: { roles: STAFF } },
      { path: "leases/new", component: LeaseFormView, meta: { roles: ADMIN } },
      { path: "leases/:id", component: LeaseFormView, meta: { roles: ADMIN } },
      { path: "approvals", component: ApprovalsView, meta: { roles: WRITE } },
      { path: "lessor-sheets", component: LessorInfoSheetsView, meta: { roles: WRITE } },
      { path: "lessee-sheets", component: LesseeInfoSheetsView, meta: { roles: WRITE } },
      // Unit Owner (Lessor)
      { path: "my-units", component: MyUnitsView, meta: { roles: ["UNIT_OWNER"] } },
      { path: "register-unit", component: RegisterUnitView, meta: { roles: ["UNIT_OWNER"] } },
      { path: "my-leases", component: OwnerLeasesView, meta: { roles: ["UNIT_OWNER"] } },
      { path: "info-sheet", component: OwnerInfoSheetView, meta: { roles: ["UNIT_OWNER"] } },
      { path: "lessor-requirements", component: MyLessorRequirementsView, meta: { roles: ["UNIT_OWNER"] } },
      // Lessee + Lessor leasing progress (portal tracker)
      { path: "leasing-progress", component: MyLeasingProgressView, meta: { roles: ["UNIT_OWNER", "TENANT"] } },
      // Tenant (Lessee)
      { path: "my-lease", component: TenantLeaseView, meta: { roles: ["TENANT"] } },
      // Published listings, inside the portal — a lessee can look without
      // signing out to reach the public gallery.
      { path: "browse-units", component: BrowseUnitsView, meta: { roles: ["TENANT"] } },
      { path: "info-sheet-tenant", component: TenantInfoSheetView, meta: { roles: ["TENANT"] } },
      // Shared
      { path: "requirements", component: RequirementsView, meta: { roles: ["TENANT", "ADMIN", "LEASING_OFFICER"] } },
      { path: "my-profile", component: MyProfileView, meta: { roles: ["UNIT_OWNER", "TENANT"] } },
      // Super Admin
      // Admin OR O-Lease: the leasing team vets portal signups, not just admins.
      { path: "account-approvals", component: AccountApprovalsView, meta: { roles: ["ADMIN", "LEASING_OFFICER"] } },
      { path: "users", component: UsersView, meta: { roles: ["ADMIN"] } },
      { path: "audit", component: AuditView, meta: { roles: ["ADMIN"] } },
      { path: "import", component: PortfolioImportView, meta: { roles: ["ADMIN"] } },
      { path: "content", component: ContentManagerView, meta: { roles: WRITE } },
      { path: "content/listings", component: ListingsManagerView, meta: { roles: WRITE } },
      { path: "forms", component: CmsFormsView, meta: { roles: ["ADMIN"] } },
      { path: "forms/:role/:pageKey", component: CmsFormBuilderView, meta: { roles: ["ADMIN"] } },
    ],
  },
];

const router = createRouter({ history: createWebHistory(), routes });
router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isAuthenticated) return "/login";
  if (!auth.isAuthenticated) return;
  // A restricted session gets one page. This is convenience, not security —
  // the server refuses the routes regardless.
  if (auth.isAuthenticated && !auth.isApproved) {
    return to.meta.allowPending ? undefined : "/app/application";
  }
  const appHome = auth.isOwner ? "/app/my-units" : auth.isTenant ? "/app/my-lease" : "/app";
  // "/" is always the public Inquiry landing — even for signed-in users.
  if (to.path === "/app" && appHome !== "/app") return appHome; // owners/tenants -> their portal
  if (to.meta.roles && !to.meta.roles.includes(auth.role)) return appHome;
});
export default router;
