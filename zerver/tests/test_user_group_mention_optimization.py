"""
Tests for user group mention optimization.

This test file covers the performance optimization where silent user group
mentions (@_*group*) do not fetch group membership data, while non-silent
mentions (@*group*) do fetch membership to trigger notifications.
"""

from zerver.actions.user_groups import check_add_user_group, do_deactivate_user_group
from zerver.lib.mention import MentionBackend, MentionData, possible_user_group_mentions
from zerver.lib.test_classes import ZulipTestCase


class UserGroupMentionOptimizationTest(ZulipTestCase):
    """
    Tests for the optimization that avoids fetching group membership for
    silent user group mentions.
    """

    def test_possible_user_group_mentions_returns_dict(self) -> None:
        """Test that possible_user_group_mentions returns a dict mapping names to mention types."""
        # Empty content
        self.assertEqual(possible_user_group_mentions(""), {})

        # No mentions
        self.assertEqual(possible_user_group_mentions("boring text"), {})

        # User mentions (not group mentions) should be ignored
        self.assertEqual(possible_user_group_mentions("@**all**"), {})
        self.assertEqual(possible_user_group_mentions("Hello @**User Name**"), {})

        # Invalid syntax (missing proper spacing)
        self.assertEqual(possible_user_group_mentions("smush@*steve*smush"), {})

    def test_possible_user_group_mentions_non_silent(self) -> None:
        """Test that non-silent mentions are correctly identified."""
        # Single non-silent mention
        self.assertEqual(
            possible_user_group_mentions("@*support*"),
            {"support": "non-silent"},
        )

        # Multiple non-silent mentions
        self.assertEqual(
            possible_user_group_mentions("@*support* and @*backend*"),
            {"support": "non-silent", "backend": "non-silent"},
        )

        # Non-silent mention with other text
        self.assertEqual(
            possible_user_group_mentions(
                "@*support* Hello @**King Hamlet** and @**Cordelia, Lear's daughter**\n"
                "@**Foo van Barson** @**all**"
            ),
            {"support": "non-silent"},
        )

        # Multiple non-silent mentions in a sentence
        self.assertEqual(
            possible_user_group_mentions("Attention @*support*, @*frontend* and @*backend*\ngroups."),
            {"support": "non-silent", "frontend": "non-silent", "backend": "non-silent"},
        )

    def test_possible_user_group_mentions_silent(self) -> None:
        """Test that silent mentions are correctly identified."""
        # Single silent mention
        self.assertEqual(
            possible_user_group_mentions("@_*support*"),
            {"support": "silent"},
        )

        # Multiple silent mentions
        self.assertEqual(
            possible_user_group_mentions("@_*support* and @_*backend*"),
            {"support": "silent", "backend": "silent"},
        )

        # Silent mention with other text
        self.assertEqual(
            possible_user_group_mentions("Check out @_*support* team"),
            {"support": "silent"},
        )

    def test_possible_user_group_mentions_precedence_non_silent_first(self) -> None:
        """Test that non-silent mention takes precedence when it appears first."""
        # Non-silent before silent
        self.assertEqual(
            possible_user_group_mentions("@*support* and also @_*support*"),
            {"support": "non-silent"},
        )

        # Multiple occurrences with non-silent first
        self.assertEqual(
            possible_user_group_mentions("@*support* text @_*support* more @_*support*"),
            {"support": "non-silent"},
        )

    def test_possible_user_group_mentions_precedence_silent_first(self) -> None:
        """Test that non-silent mention overrides silent even when silent appears first."""
        # Silent before non-silent (non-silent should win)
        self.assertEqual(
            possible_user_group_mentions("@_*support* and also @*support*"),
            {"support": "non-silent"},
        )

        # Multiple occurrences with silent first but non-silent later
        self.assertEqual(
            possible_user_group_mentions("@_*support* text @_*support* then @*support*"),
            {"support": "non-silent"},
        )

    def test_possible_user_group_mentions_mixed_groups(self) -> None:
        """Test handling of multiple groups with different mention types."""
        # Some silent, some non-silent
        self.assertEqual(
            possible_user_group_mentions("@*support* team and @_*backend* team"),
            {"support": "non-silent", "backend": "silent"},
        )

        # Three groups: one non-silent, one silent, one mixed
        self.assertEqual(
            possible_user_group_mentions("@*support* @_*frontend* @_*backend* @*backend*"),
            {"support": "non-silent", "frontend": "silent", "backend": "non-silent"},
        )

    def test_mention_data_fetches_membership_for_non_silent_only(self) -> None:
        """
        Test that MentionData only fetches group membership for non-silent mentions.

        This is the core optimization test.
        """
        realm = self.example_user("hamlet").realm
        hamlet = self.example_user("hamlet")
        cordelia = self.example_user("cordelia")
        othello = self.example_user("othello")

        # Create test groups
        support_group = check_add_user_group(
            realm, "support", [hamlet, cordelia], acting_user=hamlet
        )
        backend_group = check_add_user_group(
            realm, "backend", [othello], acting_user=hamlet
        )

        mention_backend = MentionBackend(realm.id)

        # Non-silent mention should fetch membership
        content_non_silent = "@*support* please help"
        mention_data = MentionData(mention_backend, content_non_silent, message_sender=None)
        self.assertEqual(
            mention_data.get_group_members(support_group.id),
            {hamlet.id, cordelia.id},
        )

        # Silent mention should NOT fetch membership (returns empty set)
        content_silent = "@_*backend* for reference"
        mention_data = MentionData(mention_backend, content_silent, message_sender=None)
        self.assertEqual(mention_data.get_group_members(backend_group.id), set())

    def test_mention_data_mixed_silent_and_non_silent(self) -> None:
        """Test that mixed mention types are handled correctly."""
        realm = self.example_user("hamlet").realm
        hamlet = self.example_user("hamlet")
        cordelia = self.example_user("cordelia")
        othello = self.example_user("othello")

        support_group = check_add_user_group(
            realm, "support", [hamlet, cordelia], acting_user=hamlet
        )
        backend_group = check_add_user_group(
            realm, "backend", [othello], acting_user=hamlet
        )

        mention_backend = MentionBackend(realm.id)

        # One non-silent, one silent
        content = "@*support* and @_*backend*"
        mention_data = MentionData(mention_backend, content, message_sender=None)

        # Support (non-silent) should have membership
        self.assertEqual(
            mention_data.get_group_members(support_group.id),
            {hamlet.id, cordelia.id},
        )

        # Backend (silent) should not have membership
        self.assertEqual(mention_data.get_group_members(backend_group.id), set())

    def test_mention_data_same_group_both_mention_types(self) -> None:
        """Test that when same group has both mention types, membership is fetched."""
        realm = self.example_user("hamlet").realm
        hamlet = self.example_user("hamlet")
        cordelia = self.example_user("cordelia")

        support_group = check_add_user_group(
            realm, "support", [hamlet, cordelia], acting_user=hamlet
        )

        mention_backend = MentionBackend(realm.id)

        # Both silent and non-silent mentions of the same group
        content = "@_*support* (see also @*support*)"
        mention_data = MentionData(mention_backend, content, message_sender=None)

        # Should fetch membership because non-silent is present
        self.assertEqual(
            mention_data.get_group_members(support_group.id),
            {hamlet.id, cordelia.id},
        )

    def test_mention_data_deactivated_group_silent_mention(self) -> None:
        """Test that deactivated groups don't fetch membership even for non-silent mentions."""
        realm = self.example_user("hamlet").realm
        hamlet = self.example_user("hamlet")
        cordelia = self.example_user("cordelia")

        support_group = check_add_user_group(
            realm, "support", [hamlet, cordelia], acting_user=hamlet
        )

        # Deactivate the group
        do_deactivate_user_group(support_group, acting_user=hamlet)

        mention_backend = MentionBackend(realm.id)

        # Non-silent mention of deactivated group should not fetch membership
        content = "@*support* are you there?"
        mention_data = MentionData(mention_backend, content, message_sender=None)
        self.assertEqual(mention_data.get_group_members(support_group.id), set())

        # Silent mention of deactivated group should not fetch membership
        content_silent = "@_*support* (deactivated)"
        mention_data_silent = MentionData(mention_backend, content_silent, message_sender=None)
        self.assertEqual(mention_data_silent.get_group_members(support_group.id), set())

    def test_mention_data_nonexistent_group(self) -> None:
        """Test handling of mentions for groups that don't exist."""
        realm = self.example_user("hamlet").realm
        mention_backend = MentionBackend(realm.id)

        # Mention a group that doesn't exist
        content = "@*nonexistent_group* help"
        mention_data = MentionData(mention_backend, content, message_sender=None)

        # Should not crash, group_name_info should be empty or not contain this group
        self.assertNotIn("nonexistent_group", mention_data.user_group_name_info)

    def test_mention_data_multiple_groups_various_states(self) -> None:
        """Test complex scenario with multiple groups in different states."""
        realm = self.example_user("hamlet").realm
        hamlet = self.example_user("hamlet")
        cordelia = self.example_user("cordelia")
        othello = self.example_user("othello")
        iago = self.example_user("iago")

        # Create groups
        support_group = check_add_user_group(realm, "support", [hamlet], acting_user=hamlet)
        backend_group = check_add_user_group(realm, "backend", [cordelia], acting_user=hamlet)
        frontend_group = check_add_user_group(realm, "frontend", [othello], acting_user=hamlet)
        admin_group = check_add_user_group(realm, "admin", [iago], acting_user=hamlet)

        # Deactivate one group
        do_deactivate_user_group(admin_group, acting_user=hamlet)

        mention_backend = MentionBackend(realm.id)

        # Complex content: support (non-silent), backend (silent), frontend (both), admin (deactivated, non-silent)
        content = "@*support* @_*backend* @_*frontend* @*frontend* @*admin*"
        mention_data = MentionData(mention_backend, content, message_sender=None)

        # Support (non-silent) - should have membership
        self.assertEqual(mention_data.get_group_members(support_group.id), {hamlet.id})

        # Backend (silent only) - should NOT have membership
        self.assertEqual(mention_data.get_group_members(backend_group.id), set())

        # Frontend (both) - should have membership because non-silent is present
        self.assertEqual(mention_data.get_group_members(frontend_group.id), {othello.id})

        # Admin (deactivated) - should NOT have membership even with non-silent mention
        self.assertEqual(mention_data.get_group_members(admin_group.id), set())

    def test_mention_data_user_group_name_info_includes_all_groups(self) -> None:
        """Test that user_group_name_info includes all mentioned groups regardless of mention type."""
        realm = self.example_user("hamlet").realm
        hamlet = self.example_user("hamlet")

        support_group = check_add_user_group(realm, "support", [hamlet], acting_user=hamlet)
        backend_group = check_add_user_group(realm, "backend", [hamlet], acting_user=hamlet)

        mention_backend = MentionBackend(realm.id)

        # Both silent and non-silent mentions
        content = "@*support* and @_*backend*"
        mention_data = MentionData(mention_backend, content, message_sender=None)

        # Both groups should be in user_group_name_info
        self.assertIn("support", mention_data.user_group_name_info)
        self.assertIn("backend", mention_data.user_group_name_info)

        # Verify they're the correct groups
        self.assertEqual(mention_data.user_group_name_info["support"].id, support_group.id)
        self.assertEqual(mention_data.user_group_name_info["backend"].id, backend_group.id)

    def test_mention_data_case_insensitive_group_names(self) -> None:
        """Test that group name lookups are case-insensitive."""
        realm = self.example_user("hamlet").realm
        hamlet = self.example_user("hamlet")
        cordelia = self.example_user("cordelia")

        # Create group with mixed case name
        support_group = check_add_user_group(realm, "Support", [hamlet, cordelia], acting_user=hamlet)

        mention_backend = MentionBackend(realm.id)

        # Mention with different case
        content = "@*support* please help"
        mention_data = MentionData(mention_backend, content, message_sender=None)

        # Should find the group (stored lowercase in user_group_name_info)
        self.assertIn("support", mention_data.user_group_name_info)
        self.assertEqual(
            mention_data.get_group_members(support_group.id),
            {hamlet.id, cordelia.id},
        )

    def test_possible_user_group_mentions_duplicate_groups(self) -> None:
        """Test that duplicate mentions of the same group (same type) are handled correctly."""
        # Multiple non-silent mentions of same group
        self.assertEqual(
            possible_user_group_mentions("@*support* and again @*support*"),
            {"support": "non-silent"},
        )

        # Multiple silent mentions of same group
        self.assertEqual(
            possible_user_group_mentions("@_*support* and again @_*support*"),
            {"support": "silent"},
        )

    def test_possible_user_group_mentions_with_special_characters_around(self) -> None:
        """Test group mentions with various surrounding characters."""
        # With punctuation
        self.assertEqual(
            possible_user_group_mentions("Hello, @*support*!"),
            {"support": "non-silent"},
        )

        # At start of line
        self.assertEqual(
            possible_user_group_mentions("@*support* can you help?"),
            {"support": "non-silent"},
        )

        # At end of line
        self.assertEqual(
            possible_user_group_mentions("Please contact @*support*"),
            {"support": "non-silent"},
        )

        # In parentheses
        self.assertEqual(
            possible_user_group_mentions("Check with team (@*support*)"),
            {"support": "non-silent"},
        )
