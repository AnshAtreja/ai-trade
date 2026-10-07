# Shadow & Live tab

**Route:** `/shadow-live` · **Source:** [`shadow-live-page.tsx`](../../apps/web/src/pages/shadow-live-page.tsx)

## Status

**Roadmap view (Phases 19–21)** with current safety status pills.

## What you see today

| Element | Meaning |
| --- | --- |
| **Live orders locked** pill | Live placement is not available |
| **Shadow not running** pill | No shadow session runner yet |
| Phase 19 / 20 / 21 summaries | Planned shadow mode, live infra, controlled live |

## Controls today

| Control | Behavior |
| --- | --- |
| None actionable | Informational phase summaries only |

## Planned phases

| Phase | Intent |
| --- | --- |
| 19 Shadow | Full decision path, `Kite order = NEVER` |
| 20 Live infra | Order manager, reconciliation, kill switch that actually gates live |
| 21 Controlled live | Gradual live with strict limits |

Until then, use **Paper** for execution practice and keep the header at **Live orders locked**.
