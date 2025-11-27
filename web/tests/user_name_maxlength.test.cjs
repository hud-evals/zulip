"use strict";

/**
 * Tests for consistent maxlength attribute on user/bot name input fields.
 *
 * This test verifies that name input fields across different settings forms
 * correctly use the MAX_USER_NAME_LENGTH constant (100) for the maxlength attribute.
 *
 * Bug: Profile settings had hardcoded maxlength="60", while admin user edit
 * and bot edit forms had no maxlength attribute at all.
 *
 * Fix: All forms should use the centralized MAX_USER_NAME_LENGTH constant.
 */

const assert = require("node:assert/strict");

const {run_test} = require("./lib/test.cjs");

const MAX_USER_NAME_LENGTH = 100;

run_test("profile_settings has correct maxlength on name input", ({mock_template}) => {
    const args = {
        max_user_name_length: MAX_USER_NAME_LENGTH,
        current_user: {
            full_name: "Test User",
            avatar_url_medium: "/avatar/test",
        },
        user_can_change_name: true,
        user_can_change_avatar: true,
        settings_object: {
            timezone: "UTC",
            web_suggest_update_timezone: false,
        },
        settings_label: {
            web_suggest_update_timezone: "Suggest updating timezone",
        },
        timezones: [],
        user_role_text: "Member",
        date_joined_text: "Jan 1, 2024",
    };

    mock_template("settings/profile_settings.hbs", true, (data, html) => {
        assert.equal(data.max_user_name_length, MAX_USER_NAME_LENGTH);
        // Verify the input has the correct maxlength attribute
        assert.ok(
            html.includes('maxlength="100"'),
            "Profile settings name input should have maxlength='100'",
        );
        // Verify it's on the full_name input specifically
        assert.ok(
            html.includes('id="full_name"') && html.includes('maxlength="100"'),
            "The maxlength should be on the full_name input",
        );
    });

    require("../templates/settings/profile_settings.hbs")(args);
});

run_test("admin_human_form has correct maxlength on name input", ({mock_template}) => {
    const args = {
        user_id: 123,
        full_name: "Test Admin User",
        email: "test@example.com",
        max_user_name_length: MAX_USER_NAME_LENGTH,
        user_role_values: [],
        disable_role_dropdown: false,
        is_active: true,
        hide_deactivate_button: false,
    };

    mock_template("settings/admin_human_form.hbs", true, (data, html) => {
        assert.equal(data.max_user_name_length, MAX_USER_NAME_LENGTH);
        // Verify the input has the correct maxlength attribute
        assert.ok(
            html.includes('maxlength="100"'),
            "Admin human form name input should have maxlength='100'",
        );
        // Verify it's on the edit_user_full_name input specifically
        assert.ok(
            html.includes('id="edit_user_full_name"') && html.includes('maxlength="100"'),
            "The maxlength should be on the edit_user_full_name input",
        );
    });

    require("../templates/settings/admin_human_form.hbs")(args);
});

run_test("edit_bot_form has correct maxlength on name input", ({mock_template}) => {
    const args = {
        user_id: 456,
        email: "bot@example.com",
        full_name: "Test Bot",
        max_bot_name_length: MAX_USER_NAME_LENGTH,
        user_role_values: [],
        disable_role_dropdown: false,
        bot_avatar_url: "/avatar/bot",
        is_incoming_webhook_bot: false,
        is_active: true,
    };

    mock_template("settings/edit_bot_form.hbs", true, (data, html) => {
        assert.equal(data.max_bot_name_length, MAX_USER_NAME_LENGTH);
        // Verify the input has the correct maxlength attribute
        assert.ok(
            html.includes('maxlength="100"'),
            "Bot edit form name input should have maxlength='100'",
        );
        // Verify it's on the edit_bot_full_name input specifically
        assert.ok(
            html.includes('id="edit_bot_full_name"') && html.includes('maxlength="100"'),
            "The maxlength should be on the edit_bot_full_name input",
        );
    });

    require("../templates/settings/edit_bot_form.hbs")(args);
});

run_test("maxlength is not hardcoded to old value", ({mock_template}) => {
    // This test specifically verifies that the old hardcoded value of 60
    // is no longer present in profile_settings
    const args = {
        max_user_name_length: MAX_USER_NAME_LENGTH,
        current_user: {
            full_name: "Test User",
            avatar_url_medium: "/avatar/test",
        },
        user_can_change_name: true,
        user_can_change_avatar: true,
        settings_object: {
            timezone: "UTC",
            web_suggest_update_timezone: false,
        },
        settings_label: {
            web_suggest_update_timezone: "Suggest updating timezone",
        },
        timezones: [],
        user_role_text: "Member",
        date_joined_text: "Jan 1, 2024",
    };

    mock_template("settings/profile_settings.hbs", true, (_data, html) => {
        // The old hardcoded value should NOT be present
        assert.ok(
            !html.includes('maxlength="60"'),
            "Profile settings should not have hardcoded maxlength='60'",
        );
    });

    require("../templates/settings/profile_settings.hbs")(args);
});

