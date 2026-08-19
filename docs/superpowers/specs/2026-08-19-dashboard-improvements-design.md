# Dashboard Improvements Design

**Date:** 2026-08-19
**Status:** Approved
**Owner:** Frontend

## Overview

Improve all four ProblemProof dashboards (Candidate, Org Queue, Account, Admin) with new visualizations, better metrics, and enhanced functionality.

## Shared Components

### StatCard
- Metric with optional trend indicator (up/down arrow with percentage)
- Supports alarm state for critical metrics
- Uses existing design tokens

### MiniTrendChart
- SVG sparkline for time-series data
- Minimal footprint, fits in metric cards
- No axis labels, just the trend

### PhaseBar
- Horizontal bar showing phase distribution
- Color-coded by phase type
- Percentage labels

## Candidate Dashboard (`/candidate`)

### New Features
1. **Process Graph mini-view** — thumbnail of last session's process graph
2. **Phase distribution bar** — breakdown across all sessions
3. **Trend sparklines** — session duration over time
4. **Quick stats** — best phase, time in recovery, etc.
5. **Share credential** — link to share verified credentials

### API Changes
- `GET /api/sessions` — already returns session list; may need enrichment for phase data

## Org Queue (`/org`)

### New Features
1. **Severity indicator** — color-coded for sessions with mid-exam identity warnings
2. **Hover preview** — tooltip with session summary
3. **Bulk actions** — select multiple → batch confirm/dispute
4. **Sort options** — by date, duration, assurance
5. **Queue health** — avg time in queue, oldest pending

### API Changes
- May need endpoint for batch actions
- Queue stats endpoint

## Account (`/account`)

### New Features
1. **Credential history** — list of issued credentials with status
2. **Skill trend** — assessment history
3. **Settings panel** — notifications, data export, deletion
4. **Session replay** — request to view own recordings

### API Changes
- `GET /api/credentials` — list user's credentials
- `GET /api/settings` — user preferences
- `POST /api/settings` — update preferences

## Admin (`/admin`)

### New Features
1. **Platform metrics over time** — charts for sessions/day, orgs/month
2. **Alert panel** — orphaned orgs, stuck sessions, failed validations
3. **Quick actions** — disable org, freeze session, promote user
4. **Export** — CSV/JSON export for tables

### API Changes
- `GET /api/admin/metrics` — time-series platform metrics
- `GET /api/admin/alerts` — current alerts
- `POST /api/admin/orgs/:id/disable` — disable org
- `POST /api/admin/sessions/:id/freeze` — freeze session
- Tables need export capability

## Visual Guidelines

- Use existing `metric-card`, `card`, `table` classes from `index.css`
- Consistent color palette (no new colors)
- Mono for measured values, sans for labels
- Keep responsive layout
- Accessibility: all charts have text alternatives

## Implementation Order

1. Create shared components (StatCard, MiniTrendChart, PhaseBar)
2. Candidate dashboard
3. Org Queue
4. Account
5. Admin

## Acceptance Criteria

- All dashboards render without errors
- New visualizations match existing design language
- Responsive on mobile/tablet/desktop
- Accessible (keyboard nav, screen reader friendly)
- No performance degradation