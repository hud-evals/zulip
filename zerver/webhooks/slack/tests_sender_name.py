"""
Tests for the Slack webhook sender name attribution.

This test file verifies that the Slack webhook correctly uses the user's
display name (real_name) for message sender attribution, rather than
their Slack username (name).

These tests are isolated in a separate file to:
1. Avoid merge conflicts with the main tests.py
2. Focus specifically on the sender name behavior
3. Use realistic Slack API response fixtures
"""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate

import responses
from typing_extensions import ParamSpec, override

from zerver.lib.test_classes import WebhookTestCase


# Test constants - using DISTINCT values for name vs real_name
# This is critical for catching the bug where the wrong field is used
SLACK_USERNAME = "supersecretemail"  # The Slack username/handle (wrong field)
DISPLAY_NAME = "John Doe"  # The display name (correct field)
CHANNEL_NAME = "general"

EXPECTED_TOPIC = "Message from Slack"
EXPECTED_MESSAGE_TEMPLATE = "**{user}**: {message}"

ParamT = ParamSpec("ParamT")


def mock_slack_api(
    test_func: Callable[Concatenate["SlackSenderNameTests", ParamT], None],
) -> Callable[Concatenate["SlackSenderNameTests", ParamT], None]:
    """
    Decorator that mocks Slack API calls with realistic response data.

    The mock returns user data with DIFFERENT values for 'name' and 'real_name'
    to distinguish between correct and incorrect implementations:
    - name: "supersecretemail" (the Slack username)
    - real_name: "John Doe" (the display name)
    """

    @wraps(test_func)
    @responses.activate
    def _wrapped(
        self: "SlackSenderNameTests", /, *args: ParamT.args, **kwargs: ParamT.kwargs
    ) -> None:
        # Mock the users.info API endpoint
        responses.add(
            responses.GET,
            "https://slack.com/api/users.info",
            self.webhook_fixture_data("slack", "slack_users_info_api_response"),
        )
        # Mock the conversations.info API endpoint
        responses.add(
            responses.GET,
            "https://slack.com/api/conversations.info",
            self.webhook_fixture_data("slack", "slack_conversations_info_api_response"),
        )
        test_func(self, *args, **kwargs)

    return _wrapped


class SlackSenderNameTests(WebhookTestCase):
    """
    Tests that verify the Slack webhook uses the correct name field for
    sender attribution.

    The Slack API provides multiple name fields:
    - name: The Slack username/handle (e.g., "supersecretemail")
    - real_name: The user's display name (e.g., "John Doe")

    Messages should show the display name, not the username.
    """

    CHANNEL_NAME = "slack"
    URL_TEMPLATE = "/api/v1/external/slack?stream={stream}&api_key={api_key}&slack_app_token=xoxp-XXXXXXXXXXXXXXXXXXXXX"
    WEBHOOK_DIR_NAME = "slack"

    # =========================================================================
    # CORE BUG FIX TESTS
    # =========================================================================

    @mock_slack_api
    def test_message_sender_uses_display_name(self) -> None:
        """
        Test that message sender attribution uses the user's display name
        (real_name field) rather than their Slack username (name field).

        Expected: **John Doe**: Hello, this is a normal text message
        Bug would show: **supersecretemail**: Hello, this is a normal text message
        """
        message_text = "Hello, this is a normal text message"
        expected_message = EXPECTED_MESSAGE_TEMPLATE.format(
            user=DISPLAY_NAME, message=message_text
        )
        self.check_webhook(
            "message_with_normal_text",
            EXPECTED_TOPIC,
            expected_message,
            content_type="application/json",
        )

    @mock_slack_api
    def test_user_mention_uses_display_name(self) -> None:
        """
        Test that @user mentions in messages show the display name.

        When a Slack message contains @mentions like <@U12345>, they should
        be converted to @**Display Name**, not @**username**.

        Expected: @**John Doe** @**John Doe** @**John Doe** hello...
        Bug would show: @**supersecretemail** @**supersecretemail**...
        """
        message_text = (
            f"@**{DISPLAY_NAME}** @**{DISPLAY_NAME}** @**{DISPLAY_NAME}** "
            "hello, this is a message with mentions"
        )
        expected_message = EXPECTED_MESSAGE_TEMPLATE.format(
            user=DISPLAY_NAME, message=message_text
        )
        self.check_webhook(
            "message_with_user_mentions",
            EXPECTED_TOPIC,
            expected_message,
            content_type="application/json",
        )

    # =========================================================================
    # EDGE CASES
    # =========================================================================

    @mock_slack_api
    def test_mixed_user_and_channel_mentions(self) -> None:
        """
        Test messages with both user and channel mentions.

        User mentions should use display name, channel mentions should use
        channel name (both use different API endpoints and fields).
        """
        message_text = (
            f"@**{DISPLAY_NAME}** **#{CHANNEL_NAME}** "
            "message with both channel and user mentions"
        )
        expected_message = EXPECTED_MESSAGE_TEMPLATE.format(
            user=DISPLAY_NAME, message=message_text
        )
        self.check_webhook(
            "message_with_channel_and_user_mentions",
            EXPECTED_TOPIC,
            expected_message,
            content_type="application/json",
        )

    @mock_slack_api
    def test_complex_formatted_mentions(self) -> None:
        """
        Test user mentions combined with complex formatting.

        Ensures display name is used even when mentions are wrapped
        in other formatting like bold, italic, strikethrough.
        """
        message_text = f"@**{DISPLAY_NAME}** **#{CHANNEL_NAME}** ~~***@**all*****~~"
        expected_message = EXPECTED_MESSAGE_TEMPLATE.format(
            user=DISPLAY_NAME, message=message_text
        )
        self.check_webhook(
            "message_with_complex_formatted_mentions",
            EXPECTED_TOPIC,
            expected_message,
            content_type="application/json",
        )

    # =========================================================================
    # REGRESSION TESTS - Verify other functionality still works
    # =========================================================================

    @mock_slack_api
    def test_channel_name_extraction_still_works(self) -> None:
        """
        Regression test: Channel name extraction should still work correctly.

        The channel name comes from conversations.info API and uses the 'name'
        field (correctly). This should NOT be affected by the user name fix.
        """
        self.url = self.build_webhook_url(channels_map_to_topics="1")
        message_text = "Hello, this is a normal text message"
        expected_topic = f"channel: {CHANNEL_NAME}"
        expected_message = EXPECTED_MESSAGE_TEMPLATE.format(
            user=DISPLAY_NAME, message=message_text
        )
        self.check_webhook(
            "message_with_normal_text",
            expected_topic,
            expected_message,
            content_type="application/json",
        )

    @mock_slack_api
    def test_message_with_files_uses_display_name(self) -> None:
        """
        Regression test: Messages with file attachments should use display name.
        """
        message_text = """
*[5e44bcbc-e43c-4a2e-85de-4be126f392f4.jpg](https://ds-py62195.slack.com/files/U06NU4E26M9/F079E4173BL/5e44bcbc-e43c-4a2e-85de-4be126f392f4.jpg)*
*[notif_bot.png](https://ds-py62195.slack.com/files/U06NU4E26M9/F079GJ49X4L/notif_bot.png)*
*[books.jpg](https://ds-py62195.slack.com/files/U06NU4E26M9/F07A2TA6PPS/books.jpg)*"""
        expected_message = EXPECTED_MESSAGE_TEMPLATE.format(
            user=DISPLAY_NAME, message=message_text
        )
        self.check_webhook(
            "message_with_image_files",
            EXPECTED_TOPIC,
            expected_message,
            content_type="application/json",
        )

    @mock_slack_api
    def test_formatted_text_uses_display_name(self) -> None:
        """
        Regression test: Formatted messages should use display name.
        """
        message_text = "**Bold text** *italic text* ~~strikethrough~~"
        expected_message = EXPECTED_MESSAGE_TEMPLATE.format(
            user=DISPLAY_NAME, message=message_text
        )
        self.check_webhook(
            "message_with_formatted_texts",
            EXPECTED_TOPIC,
            expected_message,
            content_type="application/json",
        )

    @mock_slack_api
    def test_code_block_uses_display_name(self) -> None:
        """
        Regression test: Messages with code blocks should use display name.
        """
        message_text = """```def is_bot_message(payload: WildValue) -&gt; bool:\n    app_api_id = payload.get(\"api_app_id\").tame(check_none_or(check_string))\n    bot_app_id = (\n        payload.get(\"event\", {})\n        .get(\"bot_profile\", {})\n        .get(\"app_id\")\n        .tame(check_none_or(check_string))\n    )\n    return bot_app_id is not None and app_api_id == bot_app_id```"""
        expected_message = EXPECTED_MESSAGE_TEMPLATE.format(
            user=DISPLAY_NAME, message=message_text
        )
        self.check_webhook(
            "message_with_code_block",
            EXPECTED_TOPIC,
            expected_message,
            content_type="application/json",
        )

    @mock_slack_api
    def test_workspace_mentions_use_display_name(self) -> None:
        """
        Regression test: Messages with @all/@channel should use display name for sender.
        """
        message_text = (
            "@**all** @**all** Sorry for mentioning. This is for the test fixtures "
            "for the Slack integration update PR I'm working on and can't be done "
            "in a private channel. :bow:"
        )
        expected_message = EXPECTED_MESSAGE_TEMPLATE.format(
            user=DISPLAY_NAME, message=message_text
        )
        self.check_webhook(
            "message_with_workspace_mentions",
            EXPECTED_TOPIC,
            expected_message,
            content_type="application/json",
        )

    @mock_slack_api
    def test_channel_mentions_use_display_name(self) -> None:
        """
        Regression test: Channel mentions should work and sender should use display name.
        """
        message_text = f"**#zulip-mirror** **#{CHANNEL_NAME}** message with channel mentions"
        expected_message = EXPECTED_MESSAGE_TEMPLATE.format(
            user=DISPLAY_NAME, message=message_text
        )
        self.check_webhook(
            "message_with_channel_mentions",
            EXPECTED_TOPIC,
            expected_message,
            content_type="application/json",
        )

    # =========================================================================
    # TOPIC/CHANNEL MAPPING TESTS - Ensure display name works in all modes
    # =========================================================================

    @mock_slack_api
    def test_display_name_with_user_specified_topic(self) -> None:
        """
        Test that display name is used when user specifies a custom topic.
        """
        expected_topic_name = "custom-topic"
        self.url = self.build_webhook_url(topic=expected_topic_name)
        message_text = "Hello, this is a normal text message"
        expected_message = EXPECTED_MESSAGE_TEMPLATE.format(
            user=DISPLAY_NAME, message=message_text
        )
        self.check_webhook(
            "message_with_normal_text",
            expected_topic_name,
            expected_message,
            content_type="application/json",
        )

    @mock_slack_api
    def test_display_name_with_channel_to_stream_mapping(self) -> None:
        """
        Test that display name is used when channels map to streams.
        """
        self.CHANNEL_NAME = CHANNEL_NAME
        self.url = self.build_webhook_url(channels_map_to_topics="0")
        message_text = "Hello, this is a normal text message"
        expected_message = EXPECTED_MESSAGE_TEMPLATE.format(
            user=DISPLAY_NAME, message=message_text
        )
        self.check_webhook(
            "message_with_normal_text",
            EXPECTED_TOPIC,
            expected_message,
            content_type="application/json",
        )

    # =========================================================================
    # VERIFICATION HELPER - Explicitly verify wrong name not present
    # =========================================================================

    @mock_slack_api
    def test_username_not_in_message(self) -> None:
        """
        Explicit verification that the Slack username is NOT used.

        This test sends a message and verifies the resulting Zulip message
        contains the display name and does NOT contain the username.
        """
        message_text = "Hello, this is a normal text message"
        expected_message = EXPECTED_MESSAGE_TEMPLATE.format(
            user=DISPLAY_NAME, message=message_text
        )

        # Verify the expected message uses display name
        assert DISPLAY_NAME in expected_message
        # Verify the username would NOT be in the expected output
        assert SLACK_USERNAME not in expected_message

        self.check_webhook(
            "message_with_normal_text",
            EXPECTED_TOPIC,
            expected_message,
            content_type="application/json",
        )

