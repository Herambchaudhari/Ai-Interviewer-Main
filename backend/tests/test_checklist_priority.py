"""
Unit tests for the checklist race-condition fix — C3: checklist empty after load.

The bug: setChecklistItems(prev => prev ?? match.items)
  - If SSE sets checklist to [] (empty array), prev = [] is not nullish.
  - The DB fetch therefore never overwrites it, leaving the user with no items.

The fix: setChecklistItems(prev => (prev?.length > 0 ? prev : match.items))
  - [] (empty) → DB items win.
  - null → DB items win.
  - [item1, item2] → keep SSE items (already have real data).

All four combinations are tested here via a pure Python mirror of the JS logic.
All tests are fully offline — no network, Supabase, or React calls.
"""
import pytest


# ── Mirror of the JS checklist-priority updater ───────────────────────────────

def _checklist_updater(prev, db_items):
    """
    Mirrors: setChecklistItems(prev => (prev?.length > 0 ? prev : match.items))
    Returns the value that React state would hold after the update.
    """
    if prev and len(prev) > 0:
        return prev
    return db_items


def _sse_apply(prev, sse_checklist):
    """
    Mirrors applyReport's: if (reportData?.checklist?.length > 0) setChecklistItems(...)
    Returns the new state (prev unchanged if SSE checklist is empty/absent).
    """
    if sse_checklist and len(sse_checklist) > 0:
        return sse_checklist
    return prev   # empty/absent SSE checklist does NOT overwrite existing state


# ═══════════════════════════════════════════════════════════════════════════════
# Core priority rule
# ═══════════════════════════════════════════════════════════════════════════════

class TestChecklistPriorityRule:
    """Tests the functional updater logic in isolation."""

    def test_null_prev_db_items_win(self):
        """prev=None → DB items are used."""
        db_items = [{"id": 1, "text": "Study OS"}]
        result = _checklist_updater(None, db_items)
        assert result == db_items

    def test_empty_prev_db_items_win(self):
        """prev=[] → DB items are used (the bug this fixes)."""
        db_items = [{"id": 1, "text": "Study OS"}]
        result = _checklist_updater([], db_items)
        assert result == db_items

    def test_non_empty_prev_kept(self):
        """prev has items → SSE/cache items are preserved; DB fetch is no-op."""
        sse_items = [{"id": 1, "text": "Study DS"}, {"id": 2, "text": "Study Alg"}]
        db_items  = [{"id": 9, "text": "Different item from DB"}]
        result = _checklist_updater(sse_items, db_items)
        assert result == sse_items

    def test_empty_db_with_empty_prev_returns_empty(self):
        """prev=[] and DB has nothing → still empty (no crash)."""
        result = _checklist_updater([], [])
        assert result == []

    def test_empty_db_with_null_prev_returns_empty(self):
        """prev=None and DB has nothing → empty (no crash)."""
        result = _checklist_updater(None, [])
        assert result == []

    def test_single_item_in_prev_is_kept(self):
        """A single-item SSE checklist is enough to block DB overwrite."""
        sse_items = [{"id": 1, "text": "one item"}]
        db_items  = [{"id": 99, "text": "db item"}]
        result = _checklist_updater(sse_items, db_items)
        assert result == sse_items


# ═══════════════════════════════════════════════════════════════════════════════
# Full lifecycle: 4 combinations of SSE × DB
# ═══════════════════════════════════════════════════════════════════════════════

class TestChecklistLifecycle:
    """
    Simulates the full two-step load:
      1. applyReport sets checklist from SSE (or leaves it as-is if SSE has none)
      2. DB useEffect updater runs and may or may not overwrite
    """

    DB_ITEMS  = [{"id": 10, "text": "DB item"}]
    SSE_ITEMS = [{"id": 20, "text": "SSE item"}]

    def test_combo_sse_has_items_db_has_items_sse_wins(self):
        """SSE arrives with items → DB useEffect should not overwrite."""
        state = None                                    # initial
        state = _sse_apply(state, self.SSE_ITEMS)      # applyReport called
        state = _checklist_updater(state, self.DB_ITEMS)  # DB useEffect runs
        assert state == self.SSE_ITEMS

    def test_combo_sse_empty_db_has_items_db_wins(self):
        """SSE arrives with [] → DB useEffect should overwrite (the C3 bug)."""
        state = None                                    # initial
        state = _sse_apply(state, [])                  # applyReport: SSE has nothing
        state = _checklist_updater(state, self.DB_ITEMS)  # DB useEffect runs
        assert state == self.DB_ITEMS

    def test_combo_sse_none_db_has_items_db_wins(self):
        """SSE has no checklist key → DB items are used."""
        state = None
        state = _sse_apply(state, None)
        state = _checklist_updater(state, self.DB_ITEMS)
        assert state == self.DB_ITEMS

    def test_combo_both_empty_state_remains_empty(self):
        """Neither SSE nor DB has items → state stays empty, no crash."""
        state = None
        state = _sse_apply(state, [])
        state = _checklist_updater(state, [])
        assert state == []

    def test_sse_items_not_overwritten_when_db_runs_after(self):
        """Even if DB useEffect fires after SSE with different data, SSE wins."""
        longer_sse = [{"id": 1}, {"id": 2}, {"id": 3}]
        state = None
        state = _sse_apply(state, longer_sse)
        state = _checklist_updater(state, self.DB_ITEMS)
        assert len(state) == 3
        assert state[0]["id"] == 1

    def test_db_runs_first_then_sse_overwrites(self):
        """If DB sets items first and SSE later arrives with its own items, SSE wins."""
        # DB sets items (prev=None → DB wins)
        state = _checklist_updater(None, self.DB_ITEMS)
        assert state == self.DB_ITEMS
        # SSE applyReport fires with new items
        state = _sse_apply(state, self.SSE_ITEMS)
        assert state == self.SSE_ITEMS

    def test_db_sets_items_sse_empty_db_preserved(self):
        """DB sets items first, then SSE arrives with [] → DB items preserved."""
        state = _checklist_updater(None, self.DB_ITEMS)
        state = _sse_apply(state, [])  # SSE has no items, applyReport guard protects
        assert state == self.DB_ITEMS


# ═══════════════════════════════════════════════════════════════════════════════
# Old bug regression
# ═══════════════════════════════════════════════════════════════════════════════

class TestOldBugRegression:
    """Directly proves the old ?? operator would have failed here."""

    def _old_buggy_updater(self, prev, db_items):
        """The OLD code: prev ?? db_items — broken because [] is not nullish."""
        if prev is None:
            return db_items
        return prev  # [] would reach here and be returned as-is

    def test_old_code_would_return_empty_when_prev_is_empty_list(self):
        """Confirms the old ?? logic fails — it returns [] instead of DB items."""
        result = self._old_buggy_updater([], [{"id": 1}])
        assert result == []  # BUG: returns empty instead of DB items

    def test_new_code_returns_db_items_when_prev_is_empty_list(self):
        """Confirms the fix returns DB items when prev=[]."""
        result = _checklist_updater([], [{"id": 1}])
        assert result == [{"id": 1}]  # FIXED: DB items used
