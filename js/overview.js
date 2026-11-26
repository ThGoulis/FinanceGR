/* ==========================================================================
   10. CHARTS, 50/30/20 RULE, TOP MERCHANTS & OVERVIEW RENDER
   ========================================================================== */
function renderCharts(totals, split, memberView) {
  const theme = getChartThemeTokens();

  const catCanvas = document.getElementById("categoryChart");
  const catEmpty = document.getElementById("categoryChartEmpty");
  if (catCanvas && typeof Chart !== "undefined") {
    const entries = Object.entries(totals.byCategory).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const hasData = entries.length > 0;
    if (catEmpty) catEmpty.style.display = hasData ? "none" : "flex";
    catCanvas.style.visibility = hasData ? "visible" : "hidden";

    if (hasData) {
      const labels = entries.map(e => e[0]);
      const values = entries.map(e => Number(e[1].toFixed(2)));
      const colors = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6", "#64748b"];

      if (categoryChartInstance) {
        categoryChartInstance.data.labels = labels;
        categoryChartInstance.data.datasets[0].data = values;
        categoryChartInstance.data.datasets[0].backgroundColor = colors;
        categoryChartInstance.data.datasets[0].borderColor = theme.borderColor;
        categoryChartInstance.options.plugins.legend.labels.color = theme.textColor;
        categoryChartInstance.update("none");
      } else {
        categoryChartInstance = new Chart(catCanvas, {
          type: "doughnut",
          data: {
            labels,
            datasets: [{
              data: values,
              backgroundColor: colors,
              borderColor: theme.borderColor,
              borderWidth: 2,
              hoverOffset: 6
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "60%",
            onClick: (_, elements) => {
              if (!elements.length) return;
              const idx = elements[0].index;
              const chosenCat = categoryChartInstance.data.labels[idx];
              if (chosenCat) {
                drillDownToTransactions({ category: chosenCat, type: "expense" });
              }
            },
            plugins: {
              legend: {
                position: "right",
                labels: {
                  color: theme.textColor,
                  usePointStyle: true,
                  boxWidth: 10,
                  padding: 12,
                  font: { size: 12, weight: "600" }
                }
              },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const val = Number(ctx.raw) || 0;
                    const sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
                    const pct = sum > 0 ? ((val / sum) * 100).toFixed(1) : "0.0";
                    return ` ${ctx.label}: ${money(val)} (${pct}%)`;
                  }
                }
              }
            }
          }
        });
      }
    }
  }

  const trendCanvas = document.getElementById("trendChart");
  if (trendCanvas && typeof Chart !== "undefined") {
    const monthNames = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαϊ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];
    const ymKeys = [];
    const labels = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      ymKeys.push(ym);
      labels.push(`${monthNames[d.getMonth()]} '${String(d.getFullYear()).slice(-2)}`);
    }

    const incSeries = [];
    const expSeries = [];
    ymKeys.forEach(ym => {
      const [y, m] = ym.split("-").map(Number);
      const lastD = new Date(y, m, 0).getDate();
      const t = getPeriodTotals(`${ym}-01`, `${ym}-${String(lastD).padStart(2, "0")}`, memberView, split);
      incSeries.push(Number(t.income.toFixed(2)));
      expSeries.push(Number(t.expense.toFixed(2)));
    });

    if (trendChartInstance) {
      trendChartInstance.data.labels = labels;
      trendChartInstance.data.datasets[0].data = incSeries;
      trendChartInstance.data.datasets[1].data = expSeries;
      trendChartInstance.options.plugins.legend.labels.color = theme.textColor;
      trendChartInstance.options.scales.x.ticks.color = theme.mutedColor;
      trendChartInstance.options.scales.x.grid.color = theme.gridColor;
      trendChartInstance.options.scales.y.ticks.color = theme.mutedColor;
      trendChartInstance.options.scales.y.grid.color = theme.gridColor;
      trendChartInstance.update("none");
    } else {
      trendChartInstance = new Chart(trendCanvas, {
        type: "bar",
        data: {
          labels,
          datasets: [
            { label: "Έσοδα", data: incSeries, backgroundColor: "#10b981", borderRadius: 7, maxBarThickness: 28 },
            { label: "Έξοδα", data: expSeries, backgroundColor: "#ef4444", borderRadius: 7, maxBarThickness: 28 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          scales: {
            x: { ticks: { color: theme.mutedColor }, grid: { display: false } },
            y: {
              beginAtZero: true,
              ticks: {
                color: theme.mutedColor,
                callback: (val) => `€${Number(val).toLocaleString("el-GR")}`
              },
              grid: { color: theme.gridColor }
            }
          },
          plugins: {
            legend: {
              position: "bottom",
              labels: { color: theme.textColor, usePointStyle: true, boxWidth: 10, font: { weight: "600" } }
            },
            tooltip: {
              callbacks: {
                label: (ctx) => ` ${ctx.dataset.label}: ${money(ctx.raw)}`
              }
            }
          }
        }
      });
    }
  }
}

function render503020(totals) {
  const container = document.getElementById("rule503020Container");
  const badge = document.getElementById("rule503020TotalBadge");
  if (!container) return;
  const netSaving = Math.max(0, totals.saving - totals.withdrawal);
  const totalAllocated = totals.needs + totals.wants + netSaving;
  const base = totals.income > 0 ? totals.income : Math.max(1, totalAllocated);

  const needsPct = (totals.needs / base) * 100;
  const wantsPct = (totals.wants / base) * 100;
  const savePct = (netSaving / base) * 100;

  if (badge) {
    if (totals.income > 0) {
      const totalPct = (totalAllocated / totals.income) * 100;
      badge.textContent = totalPct > 100.5
        ? `⚠️ Διάθεση: ${totalPct.toFixed(0)}% (Υπέρβαση εσόδων)`
        : `Συνολική διάθεση: ${totalPct.toFixed(0)}% εσόδων`;
      badge.style.color = totalPct > 100.5 ? "var(--danger)" : "var(--muted)";
    } else {
      badge.textContent = "Ανάγκες • Επιθυμίες • Αποταμίευση";
      badge.style.color = "var(--muted)";
    }
  }

  container.innerHTML = `
    <div style="margin-bottom:12px;">
      <div class="kpi-label"><span>🏠 Ανάγκες (Στόχος ≤ 50%)</span><span>${money(totals.needs)} (${needsPct.toFixed(1)}%)</span></div>
      <div class="progress"><div style="width:${Math.min(100, needsPct)}%; background:${needsPct > 55 ? "var(--danger)" : "var(--primary)"};"></div></div>
    </div>
    <div style="margin-bottom:12px;">
      <div class="kpi-label"><span>🎉 Επιθυμίες (Στόχος ≤ 30%)</span><span>${money(totals.wants)} (${wantsPct.toFixed(1)}%)</span></div>
      <div class="progress"><div style="width:${Math.min(100, wantsPct)}%; background:${wantsPct > 35 ? "var(--warn)" : "var(--purple)"};"></div></div>
    </div>
    <div>
      <div class="kpi-label"><span>🐷 Καθαρή Αποταμίευση (Στόχος ≥ 20%)</span><span>${money(netSaving)} (${savePct.toFixed(1)}%)</span></div>
      <div class="progress"><div style="width:${Math.min(100, savePct)}%; background:var(--accent);"></div></div>
    </div>
  `;
}

function renderTopMerchants(ctx, split, memberView) {
  const container = document.getElementById("topMerchantsContainer");
  if (!container) return;

  const txs = filterTransactionsByMemberView(filterTransactionsForRange(ctx.start, ctx.end, true), memberView, split)
    .filter(t => t.type === "expense");

  const map = new Map();
  txs.forEach(t => {
    const label = (t.description || t.category || "Άλλο").trim();
    const key = label.toLowerCase();
    const amt = getEffectiveTxAmountForMemberView(t, memberView, split);
    if (!map.has(key)) map.set(key, { label, total: 0, count: 0 });
    const entry = map.get(key);
    entry.total += amt;
    entry.count++;
  });

  const top5 = Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 5);
  if (top5.length === 0) {
    container.innerHTML = `<div class="small">Δεν υπάρχουν δαπάνες στην επιλεγμένη περίοδο.</div>`;
    return;
  }

  container.innerHTML = top5.map(item => `
    <div class="drilldown-row" data-merchant="${escapeHtml(item.label)}" data-click="drillDownMerchant" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <strong>${escapeHtml(item.label)}</strong>
        <div class="small">${item.count} συναλλαγές</div>
      </div>
      <div class="privacy-sensitive" style="font-weight:700; color:var(--danger);">${money(item.total)}</div>
    </div>
  `).join("");
}

function renderAnomalyAlert(totals, split, memberView) {
  const banner = document.getElementById("anomalyAlertBanner");
  if (!banner) return;

  const actx = getActivePeriodContext();
  if (actx.mode !== "month") {
    banner.style.display = "none";
    return;
  }
  const [aY, aM] = actx.key.split("-").map(Number);
  const now = new Date(aY, aM - 1, 1);
  const prevTotalsList = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const lastD = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    prevTotalsList.push(getPeriodTotals(`${ym}-01`, `${ym}-${String(lastD).padStart(2, "0")}`, memberView, split));
  }

  const activeMonths = prevTotalsList.filter(t => t.expense > 0);
  if (activeMonths.length < 2) {
    banner.style.display = "none";
    return;
  }

  const spikes = [];
  for (const [cat, curAmt] of Object.entries(totals.byCategory || {})) {
    if (curAmt < 30 || cat === "Στέγαση") continue;
    const avgPrev = activeMonths.reduce((s, t) => s + (t.byCategory[cat] || 0), 0) / activeMonths.length;
    if (avgPrev >= 20 && curAmt > avgPrev * 1.35) {
      const pctOver = Math.round(((curAmt - avgPrev) / avgPrev) * 100);
      spikes.push({ cat, curAmt, avgPrev, pctOver });
    }
  }

  if (spikes.length === 0) {
    banner.style.display = "none";
    return;
  }

  spikes.sort((a, b) => b.pctOver - a.pctOver);
  const top = spikes[0];
  banner.style.display = "flex";
  banner.innerHTML = `
    <div>
      <strong>⚡ Ασυνήθιστη Αύξηση στη «${escapeHtml(top.cat)}» (+${top.pctOver}%)</strong>
      <div class="small">Έχεις δαπανήσει <strong>${money(top.curAmt)}</strong> έναντι μέσου όρου <strong>${money(top.avgPrev)}</strong> τους προηγούμενους μήνες.</div>
    </div>
    <button type="button" class="secondary small-btn" data-cat="${escapeHtml(top.cat)}" data-click="drillDownCategory">🔍 Προβολή</button>
  `;
}

function renderCoupleSettlement(ctx, split) {
  const panel = document.getElementById("coupleSettlementPanel");
  const body = document.getElementById("coupleSettlementBody");
  if (!panel || !body) return;

  if (!split.hasPartner) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "block";

  const sharedTxs = filterTransactionsForRange(ctx.start, ctx.end, true)
    .filter(t => t.type === "expense" && t.isShared && !t.settled && t.paidBy !== "split");

  let partnerOwesMe = 0;
  let iOwePartner = 0;

  sharedTxs.forEach(t => {
    const amt = Number(t.amount) || 0;
    if (t.paidBy === "me") {
      partnerOwesMe += (amt * split.partnerPct) / 100;
    } else if (t.paidBy === "partner") {
      iOwePartner += (amt * split.myPct) / 100;
    }
  });

  const net = Number((partnerOwesMe - iOwePartner).toFixed(2));
  if (Math.abs(net) < 0.01) {
    body.innerHTML = `✅ Είστε <strong>απόλυτα ισοσκελισμένοι (€0,00)</strong> στα κοινά έξοδα της περιόδου (Αναλογία ${split.myPct}% / ${split.partnerPct}%).`;
  } else if (net > 0) {
    body.innerHTML = `Ο/Η <strong>${escapeHtml(split.partnerName)}</strong> σου οφείλει <strong style="color:var(--accent);">${money(net)}</strong> (Αναλογία ${split.myPct}% / ${split.partnerPct}%).`;
  } else {
    body.innerHTML = `Οφείλεις στον/στην <strong>${escapeHtml(split.partnerName)}</strong> <strong style="color:var(--danger);">${money(Math.abs(net))}</strong> (Αναλογία ${split.myPct}% / ${split.partnerPct}%).`;
  }
}



function toggleNwBreakdown() {
  const grid = document.getElementById("nwBreakdownGrid");
  const btn = document.getElementById("toggleNwBreakdownBtn");
  if (!grid) return;
  const isHidden = grid.style.display === "none" || !grid.style.display;
  grid.style.display = isHidden ? "grid" : "none";
  if (btn) btn.textContent = isHidden ? "▴ Απόκρυψη" : "▾ Ανάλυση";
}

function toggleOverviewMoreInsights() {
  const box = document.getElementById("overviewMoreInsights");
  const btn = document.getElementById("toggleOverviewMoreBtn");
  if (!box) return;
  const isHidden = box.style.display === "none" || !box.style.display;
  box.style.display = isHidden ? "grid" : "none";
  if (btn) {
    btn.textContent = isHidden
      ? "▴ Απόκρυψη: Κανόνας 50/30/20 & Top 5 Έμποροι"
      : "▾ Περισσότερα: Κανόνας 50/30/20 & Top 5 Έμποροι";
  }
}
