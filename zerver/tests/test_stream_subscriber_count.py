"""
Tests for the Stream.subscriber_count field functionality.

This test file covers all aspects of the subscriber_count feature:
- Bulk subscription/unsubscription operations
- User signup flow
- User activation/deactivation
- Single subscription operations
- Edge cases and idempotency
"""

from collections import defaultdict
from collections.abc import Iterable
from urllib.parse import quote

import orjson

from zerver.actions.create_user import do_reactivate_user
from zerver.actions.streams import bulk_add_subscriptions, bulk_remove_subscriptions
from zerver.actions.users import do_change_user_role, do_deactivate_user
from zerver.lib.stream_subscription import (
    get_active_subscriptions_for_stream_ids,
    get_user_subscribed_streams,
)
from zerver.lib.test_classes import ZulipTestCase
from zerver.models import Stream, UserProfile
from zerver.models.realms import get_realm
from zerver.models.users import get_user_by_delivery_email


class StreamSubscriberCountTest(ZulipTestCase):
    """Tests for Stream.subscriber_count field maintenance."""

    # ========================================
    # Test Helper Methods
    # ========================================

    def assert_stream_subscriber_count(
        self,
        counts_before: dict[int, int],
        counts_after: dict[int, int],
        expected_difference: int,
    ) -> None:
        """
        Assert that subscriber_count changed by expected_difference for all streams.
        """
        self.assertEqual(
            set(counts_before),
            set(counts_after),
            msg="Different streams! You should compare subscriber_count for the same streams.",
        )

        for stream_id, count_before in counts_before.items():
            self.assertEqual(
                count_before + expected_difference,
                counts_after[stream_id],
                msg=f"stream of ID ({stream_id}) should have a subscriber_count of {count_before + expected_difference}.",
            )

    def build_streams_subscriber_count(self, streams: Iterable[Stream]) -> dict[int, int]:
        """Build a dict mapping stream_id -> subscriber_count."""
        return {stream.id: stream.subscriber_count for stream in streams}

    def fetch_streams_subscriber_count(self, stream_ids: set[int]) -> dict[int, int]:
        """Fetch current subscriber_count values from DB for the given stream IDs."""
        return self.build_streams_subscriber_count(streams=Stream.objects.filter(id__in=stream_ids))

    def fetch_other_streams_subscriber_count(self, stream_ids: set[int]) -> dict[int, int]:
        """Fetch subscriber_count for streams NOT in the given set."""
        return self.build_streams_subscriber_count(
            streams=Stream.objects.exclude(id__in=stream_ids)
        )

    # ========================================
    # Tests from test_populate_db.py
    # ========================================

    def test_bulk_create_stream_subscriptions(self) -> None:
        """
        Verify that bulk_create_stream_subscriptions correctly sets subscriber_count
        when test data is loaded via populate_db.py.
        """
        realm = get_realm("zulip")
        streams = Stream.objects.filter(realm=realm)
        active_subscriptions = get_active_subscriptions_for_stream_ids(
            {stream.id for stream in streams}
        ).select_related("recipient")

        # Map stream_id to its number of active subscriptions.
        expected_subscriber_count: dict[int, int] = defaultdict(int)

        for sub in active_subscriptions:
            expected_subscriber_count[sub.recipient.type_id] += 1

        for stream in streams:
            self.assertEqual(
                stream.subscriber_count,
                expected_subscriber_count[stream.id],
                msg=f"""
                stream of ID ({stream.id}) should have a subscriber_count of {expected_subscriber_count[stream.id]}.
                """,
            )

    # ========================================
    # Tests from test_signup.py
    # ========================================

    def test_signup_stream_subscriber_count(self) -> None:
        """
        Verify that signing up successfully increments subscriber_count by 1
        for that new user's subscribed streams.
        """
        email = "newguy@zulip.com"
        password = "newpassword"
        realm = get_realm("zulip")

        all_streams_subscriber_count = self.build_streams_subscriber_count(
            streams=Stream.objects.all()
        )

        # Perform signup flow
        result = self.client_post("/accounts/home/", {"email": email})
        self.assertEqual(result.status_code, 302)
        self.assertTrue(
            result["Location"].endswith(f"/accounts/send_confirm/?email={quote(email)}")
        )

        # Visit the confirmation link
        confirmation_url = self.get_confirmation_url_from_outbox(
            email, email_body_contains="You recently signed up for Zulip. Awesome!"
        )
        result = self.client_get(confirmation_url)
        self.assertEqual(result.status_code, 200)

        # Complete registration
        result = self.submit_reg_form_for_user(email, password, full_name="New User")
        self.assertEqual(result.status_code, 302)

        user_profile = get_user_by_delivery_email(email, realm)
        user_stream_ids = {stream.id for stream in get_user_subscribed_streams(user_profile)}

        streams_subscriber_counts_before = {
            stream_id: count
            for stream_id, count in all_streams_subscriber_count.items()
            if stream_id in user_stream_ids
        }

        other_streams_subscriber_counts_before = {
            stream_id: count
            for stream_id, count in all_streams_subscriber_count.items()
            if stream_id not in user_stream_ids
        }

        # DB-refresh streams.
        streams_subscriber_counts_after = self.fetch_streams_subscriber_count(user_stream_ids)

        # DB-refresh other_streams.
        other_streams_subscriber_counts_after = self.fetch_other_streams_subscriber_count(
            user_stream_ids
        )

        # Signing up a user should result in subscriber_count + 1
        self.assert_stream_subscriber_count(
            streams_subscriber_counts_before,
            streams_subscriber_counts_after,
            expected_difference=1,
        )

        # Make sure other streams are not affected upon signup.
        self.assert_stream_subscriber_count(
            other_streams_subscriber_counts_before,
            other_streams_subscriber_counts_after,
            expected_difference=0,
        )

    # ========================================
    # Tests from test_subs.py
    # ========================================

    def test_stream_subscriber_count_upon_bulk_subscription(self) -> None:
        """
        Test subscriber_count increases for the correct streams
        upon bulk subscription.

        We use the API here as we want this to be end-to-end.
        """
        stream_names = [f"stream_{i}" for i in range(10)]
        stream_ids = {self.make_stream(stream_name).id for stream_name in stream_names}

        desdemona = self.example_user("desdemona")
        self.login_user(desdemona)

        user_ids = [
            desdemona.id,
            self.example_user("cordelia").id,
            self.example_user("hamlet").id,
            self.example_user("othello").id,
            self.example_user("iago").id,
            self.example_user("prospero").id,
        ]

        streams_subscriber_counts_before_subscribe = self.fetch_streams_subscriber_count(stream_ids)
        other_streams_subscriber_counts_before_subscribe = (
            self.fetch_other_streams_subscriber_count(stream_ids)
        )

        # Subscribe users to the streams.
        self.subscribe_via_post(
            desdemona,
            stream_names,
            dict(principals=orjson.dumps(user_ids).decode()),
        )

        # DB-refresh streams.
        streams_subscriber_counts_after_subscribe = self.fetch_streams_subscriber_count(stream_ids)
        # DB-refresh other streams.
        other_streams_subscriber_counts_after_subscribe = self.fetch_other_streams_subscriber_count(
            stream_ids
        )

        # Ensure an increase in subscriber_count
        self.assert_stream_subscriber_count(
            streams_subscriber_counts_before_subscribe,
            streams_subscriber_counts_after_subscribe,
            expected_difference=len(user_ids),
        )

        # Make sure other streams are not affected.
        self.assert_stream_subscriber_count(
            other_streams_subscriber_counts_before_subscribe,
            other_streams_subscriber_counts_after_subscribe,
            expected_difference=0,
        )

        # Re-subscribe same users to the same streams.
        self.subscribe_via_post(
            desdemona,
            stream_names,
            dict(principals=orjson.dumps(user_ids).decode()),
        )
        # DB-refresh streams.
        streams_subscriber_counts_after_resubscribe = self.fetch_streams_subscriber_count(
            stream_ids
        )
        # Ensure Idempotency; subscribing "already" subscribed users shouldn't change subscriber_count.
        self.assert_stream_subscriber_count(
            streams_subscriber_counts_after_subscribe,
            streams_subscriber_counts_after_resubscribe,
            expected_difference=0,
        )

    def test_stream_subscriber_count_upon_bulk_unsubscription(self) -> None:
        """
        Test subscriber_count decreases for the correct streams
        upon bulk un-subscription.

        We use the API here as we want this to be end-to-end.
        """
        stream_names = [f"stream_{i}" for i in range(10)]
        stream_ids = {self.make_stream(stream_name).id for stream_name in stream_names}

        desdemona = self.example_user("desdemona")
        self.login_user(desdemona)

        user_ids = [
            desdemona.id,
            self.example_user("cordelia").id,
            self.example_user("hamlet").id,
            self.example_user("othello").id,
            self.example_user("iago").id,
            self.example_user("prospero").id,
        ]

        # Subscribe users to the streams first.
        self.subscribe_via_post(
            desdemona,
            stream_names,
            dict(principals=orjson.dumps(user_ids).decode()),
        )

        streams_subscriber_counts_before_unsubscribe = self.fetch_streams_subscriber_count(
            stream_ids
        )
        other_streams_subscriber_counts_before_unsubscribe = (
            self.fetch_other_streams_subscriber_count(stream_ids)
        )

        # Unsubscribe users from the same streams.
        self.client_delete(
            "/json/users/me/subscriptions",
            {
                "subscriptions": orjson.dumps(stream_names).decode(),
                "principals": orjson.dumps(user_ids).decode(),
            },
        )

        # DB-refresh streams.
        streams_subscriber_counts_after_unsubscribe = self.fetch_streams_subscriber_count(
            stream_ids
        )
        # DB-refresh other streams.
        other_streams_subscriber_counts_after_unsubscribe = (
            self.fetch_other_streams_subscriber_count(stream_ids)
        )

        # Ensure a decrease in subscriber_count
        self.assert_stream_subscriber_count(
            streams_subscriber_counts_before_unsubscribe,
            streams_subscriber_counts_after_unsubscribe,
            expected_difference=-len(user_ids),
        )

        # Make sure other streams are not affected.
        self.assert_stream_subscriber_count(
            other_streams_subscriber_counts_before_unsubscribe,
            other_streams_subscriber_counts_after_unsubscribe,
            expected_difference=0,
        )

        # Re-Unsubscribe users from the same streams.
        self.client_delete(
            "/json/users/me/subscriptions",
            {
                "subscriptions": orjson.dumps(stream_names).decode(),
                "principals": orjson.dumps(user_ids).decode(),
            },
        )
        # DB-refresh streams.
        streams_subscriber_counts_after_reunsubscribe = self.fetch_streams_subscriber_count(
            stream_ids
        )
        # Ensure Idempotency; unsubscribing "already" non-subscribed users shouldn't change subscriber_count.
        self.assert_stream_subscriber_count(
            streams_subscriber_counts_after_unsubscribe,
            streams_subscriber_counts_after_reunsubscribe,
            expected_difference=0,
        )

    # ========================================
    # Tests from test_users.py
    # ========================================

    def test_stream_subscriber_count_upon_deactivate(self) -> None:
        """
        Test subscriber_count decrements upon deactivating a user.
        We use the API here as we want this to be end-to-end.
        """
        admin = self.example_user("othello")
        do_change_user_role(admin, UserProfile.ROLE_REALM_ADMINISTRATOR, acting_user=None)
        self.login("othello")
        user = self.example_user("hamlet")

        streams_subscriber_counts_before = self.build_streams_subscriber_count(
            streams=get_user_subscribed_streams(user)
        )
        stream_ids = set(streams_subscriber_counts_before)
        other_streams_subscriber_counts_before = self.fetch_other_streams_subscriber_count(
            stream_ids
        )

        result = self.client_delete(f"/json/users/{user.id}")
        self.assert_json_success(result)

        # DB-refresh streams.
        streams_subscriber_counts_after = self.fetch_streams_subscriber_count(stream_ids)

        # DB-refresh other_streams.
        other_streams_subscriber_counts_after = self.fetch_other_streams_subscriber_count(
            stream_ids
        )

        # Deactivating a user should result in subscriber_count - 1
        self.assert_stream_subscriber_count(
            streams_subscriber_counts_before,
            streams_subscriber_counts_after,
            expected_difference=-1,
        )

        # Make sure other streams are not affected upon deactivation.
        self.assert_stream_subscriber_count(
            other_streams_subscriber_counts_before,
            other_streams_subscriber_counts_after,
            expected_difference=0,
        )

    def test_stream_subscriber_count_upon_reactivate(self) -> None:
        """
        Test subscriber_count increments upon reactivating a user.
        We use the API here as we want this to be end-to-end.
        """
        admin = self.example_user("othello")
        do_change_user_role(admin, UserProfile.ROLE_REALM_ADMINISTRATOR, acting_user=None)
        self.login("othello")
        user = self.example_user("hamlet")

        # First, deactivate that user
        result = self.client_delete(f"/json/users/{user.id}")
        self.assert_json_success(result)

        streams_subscriber_counts_before = self.build_streams_subscriber_count(
            streams=get_user_subscribed_streams(user)
        )
        stream_ids = set(streams_subscriber_counts_before)
        other_streams_subscriber_counts_before = self.fetch_other_streams_subscriber_count(
            stream_ids
        )

        # Reactivate user
        result = self.client_post(f"/json/users/{user.id}/reactivate")
        self.assert_json_success(result)

        # DB-refresh streams.
        streams_subscriber_counts_after = self.fetch_streams_subscriber_count(stream_ids)

        # DB-refresh other_streams.
        other_streams_subscriber_counts_after = self.fetch_other_streams_subscriber_count(
            stream_ids
        )

        # Reactivating a user should result in subscriber_count + 1
        self.assert_stream_subscriber_count(
            streams_subscriber_counts_before,
            streams_subscriber_counts_after,
            expected_difference=1,
        )

        # Make sure other streams are not affected upon reactivation.
        self.assert_stream_subscriber_count(
            other_streams_subscriber_counts_before,
            other_streams_subscriber_counts_after,
            expected_difference=0,
        )

    # ========================================
    # Additional Tests for Comprehensiveness
    # ========================================

    def test_subscriber_count_new_stream_starts_at_zero(self) -> None:
        """
        Verify that a newly created stream starts with subscriber_count=0.
        """
        stream = self.make_stream("brand_new_stream")
        self.assertEqual(stream.subscriber_count, 0)

    def test_subscriber_count_with_bots(self) -> None:
        """
        Verify that active bots ARE counted in subscriber_count.
        (Bots have is_active=True, so they should be counted.)
        """
        stream = self.make_stream("stream_with_bot")
        stream_id = stream.id

        # Get the webhook bot (an active bot)
        bot = self.example_user("webhook_bot")
        self.assertTrue(bot.is_bot)
        self.assertTrue(bot.is_active)

        # Get a human user
        human = self.example_user("hamlet")

        count_before = Stream.objects.get(id=stream_id).subscriber_count
        self.assertEqual(count_before, 0)

        # Subscribe both bot and human
        bulk_add_subscriptions(
            realm=stream.realm,
            streams=[stream],
            users=[bot, human],
            acting_user=None,
        )

        # Both should be counted
        stream.refresh_from_db()
        self.assertEqual(stream.subscriber_count, 2)

    def test_subscriber_count_mixed_active_inactive(self) -> None:
        """
        Test that only active users are counted, even when subscribing
        a mix of active and deactivated users.
        """
        stream = self.make_stream("mixed_users_stream")
        realm = stream.realm

        # Get some users
        active_user = self.example_user("hamlet")
        user_to_deactivate = self.example_user("cordelia")

        # Deactivate one user first
        do_deactivate_user(user_to_deactivate, acting_user=None)
        self.assertFalse(user_to_deactivate.is_active)

        count_before = stream.subscriber_count
        self.assertEqual(count_before, 0)

        # Subscribe both users (one active, one deactivated)
        bulk_add_subscriptions(
            realm=realm,
            streams=[stream],
            users=[active_user, user_to_deactivate],
            acting_user=None,
        )

        stream.refresh_from_db()
        # Only the active user should be counted
        self.assertEqual(stream.subscriber_count, 1)

        # Reactivate the deactivated user
        do_reactivate_user(user_to_deactivate, acting_user=None)

        stream.refresh_from_db()
        # Now both should be counted
        self.assertEqual(stream.subscriber_count, 2)

    def test_subscriber_count_private_stream(self) -> None:
        """
        Verify that subscriber_count works correctly for private streams.
        """
        stream = self.make_stream("private_test_stream", invite_only=True)
        realm = stream.realm

        user1 = self.example_user("hamlet")
        user2 = self.example_user("cordelia")

        self.assertEqual(stream.subscriber_count, 0)

        # Subscribe users
        bulk_add_subscriptions(
            realm=realm,
            streams=[stream],
            users=[user1, user2],
            acting_user=None,
        )

        stream.refresh_from_db()
        self.assertEqual(stream.subscriber_count, 2)

        # Unsubscribe one
        bulk_remove_subscriptions(
            realm=realm,
            users=[user1],
            streams=[stream],
            acting_user=None,
        )

        stream.refresh_from_db()
        self.assertEqual(stream.subscriber_count, 1)

    def test_subscriber_count_idempotency_subscribe(self) -> None:
        """
        Verify that subscribing an already-subscribed user doesn't change the count.
        """
        stream = self.make_stream("idempotent_sub_stream")
        realm = stream.realm
        user = self.example_user("hamlet")

        # First subscription
        bulk_add_subscriptions(
            realm=realm,
            streams=[stream],
            users=[user],
            acting_user=None,
        )

        stream.refresh_from_db()
        count_after_first = stream.subscriber_count
        self.assertEqual(count_after_first, 1)

        # Second subscription (same user, same stream)
        bulk_add_subscriptions(
            realm=realm,
            streams=[stream],
            users=[user],
            acting_user=None,
        )

        stream.refresh_from_db()
        # Count should remain the same
        self.assertEqual(stream.subscriber_count, count_after_first)

    def test_subscriber_count_idempotency_unsubscribe(self) -> None:
        """
        Verify that unsubscribing an already-unsubscribed user doesn't change the count.
        """
        stream = self.make_stream("idempotent_unsub_stream")
        realm = stream.realm
        user = self.example_user("hamlet")

        # Subscribe first
        bulk_add_subscriptions(
            realm=realm,
            streams=[stream],
            users=[user],
            acting_user=None,
        )

        stream.refresh_from_db()
        self.assertEqual(stream.subscriber_count, 1)

        # First unsubscription
        bulk_remove_subscriptions(
            realm=realm,
            users=[user],
            streams=[stream],
            acting_user=None,
        )

        stream.refresh_from_db()
        self.assertEqual(stream.subscriber_count, 0)

        # Second unsubscription (user already not subscribed)
        bulk_remove_subscriptions(
            realm=realm,
            users=[user],
            streams=[stream],
            acting_user=None,
        )

        stream.refresh_from_db()
        # Count should remain 0
        self.assertEqual(stream.subscriber_count, 0)

    def test_subscriber_count_other_streams_unaffected(self) -> None:
        """
        Verify that subscribing/unsubscribing only affects the target streams.
        """
        stream1 = self.make_stream("stream_target")
        stream2 = self.make_stream("stream_other")
        realm = stream1.realm

        user = self.example_user("hamlet")

        # Subscribe user to both streams
        bulk_add_subscriptions(
            realm=realm,
            streams=[stream1, stream2],
            users=[user],
            acting_user=None,
        )

        stream1.refresh_from_db()
        stream2.refresh_from_db()
        self.assertEqual(stream1.subscriber_count, 1)
        self.assertEqual(stream2.subscriber_count, 1)

        # Unsubscribe from stream1 only
        bulk_remove_subscriptions(
            realm=realm,
            users=[user],
            streams=[stream1],
            acting_user=None,
        )

        stream1.refresh_from_db()
        stream2.refresh_from_db()
        self.assertEqual(stream1.subscriber_count, 0)
        # stream2 should be unaffected
        self.assertEqual(stream2.subscriber_count, 1)

    def test_subscriber_count_multiple_streams_multiple_users(self) -> None:
        """
        Test bulk operations with multiple streams and multiple users.
        """
        streams = [self.make_stream(f"multi_stream_{i}") for i in range(5)]
        realm = streams[0].realm

        users = [
            self.example_user("hamlet"),
            self.example_user("cordelia"),
            self.example_user("othello"),
        ]

        # Subscribe all users to all streams
        bulk_add_subscriptions(
            realm=realm,
            streams=streams,
            users=users,
            acting_user=None,
        )

        for stream in streams:
            stream.refresh_from_db()
            self.assertEqual(stream.subscriber_count, len(users))

        # Unsubscribe one user from all streams
        bulk_remove_subscriptions(
            realm=realm,
            users=[users[0]],
            streams=streams,
            acting_user=None,
        )

        for stream in streams:
            stream.refresh_from_db()
            self.assertEqual(stream.subscriber_count, len(users) - 1)

    def test_subscriber_count_deactivate_user_not_subscribed(self) -> None:
        """
        Verify deactivating a user who isn't subscribed to any streams
        doesn't cause issues.
        """
        # Get a user who has subscriptions
        user = self.example_user("polonius")  # Guest user with limited subscriptions

        # Create a new stream that the user is NOT subscribed to
        stream = self.make_stream("unrelated_stream")
        other_user = self.example_user("hamlet")

        # Subscribe other_user to the stream
        bulk_add_subscriptions(
            realm=stream.realm,
            streams=[stream],
            users=[other_user],
            acting_user=None,
        )

        stream.refresh_from_db()
        count_before = stream.subscriber_count
        self.assertEqual(count_before, 1)

        # Deactivate polonius (who is not subscribed to this stream)
        do_deactivate_user(user, acting_user=None)

        # The stream count should be unchanged
        stream.refresh_from_db()
        self.assertEqual(stream.subscriber_count, count_before)

        # Reactivate for cleanup
        do_reactivate_user(user, acting_user=None)

