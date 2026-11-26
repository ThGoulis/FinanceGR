/* ==========================================================================
   ADMIN CONSOLE EVENT DELEGATION (STRICT CSP — ZERO INLINE HANDLERS)
   ========================================================================== */
let _financeGrAdminEventsBound = false;

function initFinanceGrAdminEventDelegation() {
  if (_financeGrAdminEventsBound) return;
  _financeGrAdminEventsBound = true;

  const ADMIN_CLICK_HANDLERS = {
    admAddMember: () => admAddMember(),
    admClearParserErrors: () => admClearParserErrors(),
    admDeleteRoom: (el) => admDeleteRoom(el.dataset.room),
    admRemoveMember: (el) => admRemoveMember(el.dataset.room, el.dataset.uid, el.dataset.email),
    admSelectRoom: (el) => admSelectRoom(el.dataset.room),
    adminSignInWithGoogle: () => adminSignInWithGoogle(),
    adminSignOut: () => adminSignOut(),
    loadAdminOverview: () => loadAdminOverview(),
    openHealthAndRun: () => {
      switchAdminTab("health");
      runAdminSystemHealthCheck();
    },
    probeCloudflareWorkerStatus: () => probeCloudflareWorkerStatus(),
    runAdminSystemHealthCheck: () => runAdminSystemHealthCheck(),
    switchAdminTab: (el) => switchAdminTab(el.dataset.arg)
  };

  const ADMIN_CHANGE_HANDLERS = {
    admChangeRole: (el) => admChangeRole(el.dataset.room, el.dataset.uid, el.value, el.dataset.email),
    admSetUserPlan: (el) => admSetUserPlan(el.dataset.uid, el.value, el.dataset.email),
    renderAuditLogTable: () => renderAuditLogTable(),
    renderSelectedRoomMembers: () => renderSelectedRoomMembers(),
    renderUsersQuotaTable: () => renderUsersQuotaTable()
  };

  const ADMIN_INPUT_HANDLERS = {
    renderRoomsOverviewTable: () => renderRoomsOverviewTable()
  };

  document.addEventListener("click", (event) => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) return;
    const el = rawTarget.closest("[data-click]");
    if (!el) return;
    const handler = ADMIN_CLICK_HANDLERS[el.dataset.click];
    if (handler) handler(el, event);
  });

  document.addEventListener("change", (event) => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) return;
    const el = rawTarget.closest("[data-change]");
    if (!el) return;
    const handler = ADMIN_CHANGE_HANDLERS[el.dataset.change];
    if (handler) handler(el, event);
  });

  document.addEventListener("input", (event) => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) return;
    const el = rawTarget.closest("[data-input]");
    if (!el) return;
    const handler = ADMIN_INPUT_HANDLERS[el.dataset.input];
    if (handler) handler(el, event);
  });
}

if (typeof document !== "undefined") {
  initFinanceGrAdminEventDelegation();
}
