"""
Tests for self-DM scheduled message read flag behavior.

This file tests that scheduled messages sent to oneself are NOT automatically
marked as read, while scheduled messages to others ARE marked as read.

These tests are isolated to avoid merge conflicts with the main scheduled
messages test file.
"""

from datetime import timedelta

import orjson
import time_machine
from django.utils.timezone import now as timezone_now

from zerver.actions.scheduled_messages import try_deliver_one_scheduled_message
from zerver.lib.test_classes import ZulipTestCase
from zerver.models import Message, ScheduledMessage, UserMessage
from zerver.models.recipients import get_or_create_direct_message_group


class ScheduledMessageSelfDMTest(ZulipTestCase):
    """Tests for self-DM scheduled message read flag behavior."""

    def last_scheduled_message(self) -> ScheduledMessage:
        return ScheduledMessage.objects.all().order_by("-id")[0]

    def do_schedule_message(
        self,
        msg_type: str,
        to: int | list[int],
        msg: str,
        scheduled_delivery_timestamp: int,
    ) -> None:
        self.login("hamlet")

        topic_name = ""
        if msg_type in ["stream", "channel"]:
            topic_name = "Test topic"

        payload = {
            "type": msg_type,
            "to": orjson.dumps(to).decode(),
            "content": msg,
            "topic": topic_name,
            "scheduled_delivery_timestamp": scheduled_delivery_timestamp,
        }

        result = self.client_post("/json/scheduled_messages", payload)
        self.assert_json_success(result)

    def deliver_scheduled_message(self, scheduled_message: ScheduledMessage) -> Message:
        """Deliver a scheduled message and return the delivered Message."""
        more_than_scheduled_delivery_datetime = scheduled_message.scheduled_timestamp + timedelta(
            minutes=1
        )

        with (
            time_machine.travel(more_than_scheduled_delivery_datetime, tick=False),
            self.assertLogs(level="INFO"),
        ):
            result = try_deliver_one_scheduled_message()
            self.assertTrue(result)

        scheduled_message.refresh_from_db()
        assert isinstance(scheduled_message.delivered_message_id, int)
        self.assertTrue(scheduled_message.delivered)
        self.assertFalse(scheduled_message.failed)

        return Message.objects.get(id=scheduled_message.delivered_message_id)

    def test_self_dm_not_marked_as_read(self) -> None:
        """
        Core bug case: A scheduled message sent to oneself should NOT be
        automatically marked as read.
        """
        sender = self.example_user("hamlet")
        content = "Test message to self"
        scheduled_delivery_datetime = timezone_now() + timedelta(minutes=5)
        scheduled_delivery_timestamp = int(scheduled_delivery_datetime.timestamp())

        self.do_schedule_message("direct", [sender.id], content, scheduled_delivery_timestamp)
        scheduled_message = self.last_scheduled_message()

        delivered_message = self.deliver_scheduled_message(scheduled_message)

        # Verify the message was sent to self
        self.assertEqual(delivered_message.sender_id, sender.id)
        self.assertEqual(delivered_message.recipient, sender.recipient)

        # Core assertion: self-DM should NOT be marked as read
        sender_user_message = UserMessage.objects.get(
            message_id=delivered_message.id, user_profile_id=sender.id
        )
        self.assertFalse(sender_user_message.flags.read)

    def test_self_dm_via_group_not_marked_as_read(self) -> None:
        """
        Edge case: A scheduled message sent to oneself via a direct message
        group (containing only the sender) should NOT be marked as read.
        """
        sender = self.example_user("hamlet")
        content = "Test message to self via group"
        scheduled_delivery_datetime = timezone_now() + timedelta(minutes=5)
        scheduled_delivery_timestamp = int(scheduled_delivery_datetime.timestamp())

        # Pre-create a direct message group for the sender only
        direct_message_group = get_or_create_direct_message_group(id_list=[sender.id])

        self.do_schedule_message("direct", [sender.id], content, scheduled_delivery_timestamp)
        scheduled_message = self.last_scheduled_message()

        delivered_message = self.deliver_scheduled_message(scheduled_message)

        # Verify the message was sent via the DM group
        self.assertEqual(delivered_message.recipient, direct_message_group.recipient)

        # Core assertion: self-DM via group should NOT be marked as read
        sender_user_message = UserMessage.objects.get(
            message_id=delivered_message.id, user_profile_id=sender.id
        )
        self.assertFalse(sender_user_message.flags.read)

    def test_dm_to_other_marked_as_read(self) -> None:
        """
        Verify existing behavior: A scheduled DM to another user should be
        automatically marked as read for the sender.
        """
        sender = self.example_user("hamlet")
        othello = self.example_user("othello")
        content = "Test message to other"
        scheduled_delivery_datetime = timezone_now() + timedelta(minutes=5)
        scheduled_delivery_timestamp = int(scheduled_delivery_datetime.timestamp())

        self.do_schedule_message("direct", [othello.id], content, scheduled_delivery_timestamp)
        scheduled_message = self.last_scheduled_message()

        delivered_message = self.deliver_scheduled_message(scheduled_message)

        # Verify the message was sent to othello
        self.assertEqual(delivered_message.sender_id, sender.id)
        self.assertEqual(delivered_message.recipient, othello.recipient)

        # DM to another user should be marked as read for sender
        sender_user_message = UserMessage.objects.get(
            message_id=delivered_message.id, user_profile_id=sender.id
        )
        self.assertTrue(sender_user_message.flags.read)

    def test_stream_message_marked_as_read(self) -> None:
        """
        Verify existing behavior: A scheduled stream message should be
        automatically marked as read for the sender.
        """
        sender = self.example_user("hamlet")
        content = "Test stream message"
        scheduled_delivery_datetime = timezone_now() + timedelta(minutes=5)
        scheduled_delivery_timestamp = int(scheduled_delivery_datetime.timestamp())
        verona_stream_id = self.get_stream_id("Verona")

        self.do_schedule_message(
            "channel", verona_stream_id, content, scheduled_delivery_timestamp
        )
        scheduled_message = self.last_scheduled_message()

        delivered_message = self.deliver_scheduled_message(scheduled_message)

        # Stream message should be marked as read for sender
        sender_user_message = UserMessage.objects.get(
            message_id=delivered_message.id, user_profile_id=sender.id
        )
        self.assertTrue(sender_user_message.flags.read)

