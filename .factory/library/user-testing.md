# User Testing

## Validation Surface

**Primary Surface:** Browser UI at http://127.0.0.1:3101

**Tool:** agent-browser

**Entry Points:**
- Main app → Project selection → Designer role
- Designer task list (status board)
- Resubmission task list
- Task detail page

## Validation Concurrency

**Max Concurrent Validators:** 5

**Rationale:**
- Machine: 16GB RAM, 10 CPU cores
- Available headroom: ~8GB * 0.7 = 5.6GB
- agent-browser per instance: ~300MB
- Dev server: ~200MB (shared)
- 5 instances = 1.5GB + 200MB = 1.7GB (within budget)

## Testing Surface Details

**Designer Task Tracking Flows:**
1. Status board view - verify task grouping by status
2. Resubmission list - verify returned tasks display
3. Task detail - verify complete information display
4. Resubmit flow - verify end-to-end workflow

**Required Test Data:**
- Tasks in different statuses (pending, approved, returned)
- Tasks with workflow history
- Tasks with return reasons
