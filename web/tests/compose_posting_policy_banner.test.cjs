"use strict";

/**
 * Tests for posting policy banner validation order bug.
 *
 * This test file verifies that the posting policy banner is correctly
 * shown AFTER validation runs, ensuring the banner reflects the current
 * validated state of the compose box.
 *
 * Bug: The posting policy banner was being checked BEFORE validation,
 * causing stale or incorrect banner states.
 *
 * Fix: The banner update is now called at the END of
 * validate_and_update_send_button_status(), AFTER validate() completes.
 */

const assert = require("node:assert/strict");

const {mock_banners} = require("./lib/compose_banner.cjs");
const {make_user_group} = require("./lib/example_group.cjs");
const {make_realm} = require("./lib/example_realm.cjs");
const {$t} = require("./lib/i18n.cjs");
const {mock_esm, zrequire} = require("./lib/namespace.cjs");
const {run_test, noop} = require("./lib/test.cjs");
const $ = require("./lib/zjquery.cjs");

// Mock modules that aren't needed for these tests
mock_esm("../src/ui_util", {
    place_caret_at_end: noop,
});

mock_esm("../src/group_permission_settings", {
    get_group_permission_setting_config: () => ({
        allow_everyone_group: true,
    }),
});

// Load required modules
const compose_banner = zrequire("compose_banner");
const compose_pm_pill = zrequire("compose_pm_pill");
const compose_state = zrequire("compose_state");
const compose_validate = zrequire("compose_validate");
const people = zrequire("people");
const {set_current_user, set_realm} = zrequire("state_data");
const stream_data = zrequire("stream_data");
const compose_recipient = zrequire("/compose_recipient");
const user_groups = zrequire("user_groups");
const {initialize_user_settings} = zrequire("user_settings");

// Set up realm and user settings
const realm = make_realm({
    realm_empty_topic_display_name: "general chat",
    realm_topics_policy: "allow_empty_topic",
});
set_realm(realm);
const current_user = {};
set_current_user(current_user);
const user_settings = {default_language: "en"};
initialize_user_settings({user_settings});

// Define test users
const me = {
    email: "me@example.com",
    user_id: 30,
    full_name: "Me Myself",
    date_joined: new Date(),
};

const admin_user = {
    email: "admin@example.com",
    user_id: 32,
    full_name: "Admin",
    is_admin: true,
};

const other_user = {
    email: "other@example.com",
    user_id: 33,
    full_name: "Other User",
};

// Initialize users
people.add_active_user(me);
people.initialize_current_user(me.user_id);
people.add_active_user(admin_user);
people.add_active_user(other_user);

// Define user groups for permission testing
const nobody = make_user_group({
    name: "role:nobody",
    id: 1,
    members: new Set(),
    is_system_group: true,
    direct_subgroup_ids: new Set(),
});

const everyone = make_user_group({
    name: "role:everyone",
    id: 2,
    members: new Set([me.user_id, other_user.user_id]),
    is_system_group: true,
    direct_subgroup_ids: new Set([5]),
});

const admin = make_user_group({
    name: "role:administrators",
    id: 3,
    members: new Set([admin_user.user_id]),
    is_system_group: true,
    direct_subgroup_ids: new Set(),
});

const moderators = make_user_group({
    name: "role:moderators",
    id: 4,
    members: new Set(),
    is_system_group: true,
    direct_subgroup_ids: new Set([3]),
});

const members = make_user_group({
    name: "role:members",
    id: 5,
    members: new Set([me.user_id]),
    is_system_group: true,
    direct_subgroup_ids: new Set([4]),
});

user_groups.initialize({realm_user_groups: [nobody, everyone, admin, moderators, members]});

// Track send button disabled state via assertion mock
let send_button_disabled = false;

// Helper function to set up compose box DOM elements
function setup_compose_dom() {
    $.clear_all_elements();
    send_button_disabled = false;

    $("textarea#compose-textarea").val("test message content");

    $(".message_comp").css = (property) => {
        assert.equal(property, "display");
        return "block";
    };
    $("#compose-send-button").trigger("focus");
    $("#compose-send-button .loader").hide();

    // Use assertion mock to track send button disabled state
    $("#compose-send-button").toggleClass = (classname, value) => {
        if (classname === "disabled-message-send-controls") {
            send_button_disabled = value;
        }
    };

    const $pm_pill_container = $.create("fake-pm-pill-container");
    $("#private_message_recipient")[0] = {};
    $("#private_message_recipient").set_parent($pm_pill_container);
    $pm_pill_container.set_find_results(".input", $("#private_message_recipient"));
    $("#private_message_recipient").before = noop;

    $("#send_message_form").set_find_results(".message-textarea", $("textarea#compose-textarea"));

    const $message_row_stub = $.create("message_row_stub");
    $("textarea#compose-textarea").closest = (selector) => {
        assert.equal(selector, ".message_row");
        $message_row_stub.length = 0;
        return $message_row_stub;
    };

    mock_banners();
}

function initialize_pm_pill(mock_template) {
    compose_pm_pill.initialize({
        on_pill_create_or_remove: compose_recipient.update_compose_area_placeholder_text,
    });
    mock_template("input_pill.hbs", false, () => "<div>pill-html</div>");
}

// Test helper to wrap test with UI setup
function test_ui(label, f) {
    run_test(label, (helpers) => {
        setup_compose_dom();
        return f(helpers);
    });
}

test_ui(
    "channel_posting_permission_banner_shown_after_validation",
    ({mock_template, override}) => {
        // This test verifies that when a user lacks posting permission,
        // the banner is correctly shown after validate_and_update_send_button_status() runs.
        //
        // In the buggy code, the banner update happens BEFORE validation,
        // so the banner may show stale information.
        // In the fixed code, the banner is updated AFTER validation.

        override(current_user, "user_id", me.user_id);
        override(realm, "realm_can_access_all_users_group", everyone.id);

        // Create a stream where only admins can post
        const restricted_stream = {
            stream_id: 201,
            name: "admin-only-stream",
            subscribed: true,
            can_send_message_group: admin.id, // Only admins can post
        };
        stream_data.add_sub_for_tests(restricted_stream);

        // Set up compose state for this restricted stream
        compose_state.set_message_type("stream");
        compose_state.set_stream_id(restricted_stream.stream_id);
        compose_state.topic("test-topic");

        // Track if the no_post_permissions banner is rendered
        let no_post_permission_banner_shown = false;
        mock_template("compose_banner/compose_banner.hbs", false, (data) => {
            if (data.classname === compose_banner.CLASSNAMES.no_post_permissions) {
                assert.equal(
                    data.banner_text,
                    $t({defaultMessage: "You do not have permission to post in this channel."}),
                );
                no_post_permission_banner_shown = true;
            }
            return "<banner-stub>";
        });

        // Call validate_and_update_send_button_status
        // In the fixed code, this should show the banner after validation
        compose_validate.validate_and_update_send_button_status();

        // Verify the banner was shown
        // This tests that the banner update happens as part of validate_and_update_send_button_status
        assert.ok(
            no_post_permission_banner_shown,
            "No post permission banner should be shown after validate_and_update_send_button_status()",
        );

        // Verify send button is disabled
        assert.ok(
            send_button_disabled,
            "Send button should be disabled when user lacks posting permission",
        );
    },
);

test_ui("channel_permission_banner_cleared_when_permitted", ({mock_template, override}) => {
    // Test that when user HAS permission, no error banner is shown
    // and any previous error banner is cleared.

    override(current_user, "user_id", me.user_id);
    override(realm, "realm_can_access_all_users_group", everyone.id);

    // Create a stream where everyone can post
    const open_stream = {
        stream_id: 202,
        name: "open-stream",
        subscribed: true,
        can_send_message_group: everyone.id, // Everyone can post
    };
    stream_data.add_sub_for_tests(open_stream);

    // Set up compose state for this open stream
    compose_state.set_message_type("stream");
    compose_state.set_stream_id(open_stream.stream_id);
    compose_state.topic("test-topic");

    // Track banner rendering
    let error_banner_shown = false;
    mock_template("compose_banner/compose_banner.hbs", false, (data) => {
        if (
            data.classname === compose_banner.CLASSNAMES.no_post_permissions ||
            data.classname === compose_banner.CLASSNAMES.cannot_send_direct_message
        ) {
            error_banner_shown = true;
        }
        return "<banner-stub>";
    });

    // Call validate_and_update_send_button_status
    compose_validate.validate_and_update_send_button_status();

    // Verify no posting permission error banner was shown
    assert.ok(
        !error_banner_shown,
        "No permission error banner should be shown when user has posting permission",
    );

    // Verify send button is NOT disabled (for posting permission reasons)
    assert.ok(
        !send_button_disabled,
        "Send button should not be disabled when user has posting permission",
    );
});

test_ui("dm_permission_banner_shown_after_validation", ({mock_template, override}) => {
    // Test that DM permission banners are correctly shown after validation.

    override(current_user, "user_id", me.user_id);
    override(realm, "realm_can_access_all_users_group", everyone.id);
    // Restrict DM sending to admins only
    override(realm, "realm_direct_message_initiator_group", admin.id);
    override(realm, "realm_direct_message_permission_group", admin.id);

    initialize_pm_pill(mock_template);

    // Set up compose state for DM
    compose_state.set_message_type("private");
    compose_state.private_message_recipient_emails("other@example.com");

    // Track if the DM restriction banner is rendered
    let dm_restriction_banner_shown = false;
    mock_template("compose_banner/cannot_send_direct_message_error.hbs", false, (data) => {
        assert.equal(data.classname, compose_banner.CLASSNAMES.cannot_send_direct_message);
        dm_restriction_banner_shown = true;
        return "<banner-stub>";
    });

    // Also handle regular banner template
    mock_template("compose_banner/compose_banner.hbs", false, () => "<banner-stub>");

    // Call validate_and_update_send_button_status
    compose_validate.validate_and_update_send_button_status();

    // Verify the DM restriction banner was shown
    assert.ok(
        dm_restriction_banner_shown,
        "DM restriction banner should be shown after validate_and_update_send_button_status()",
    );

    // Verify send button is disabled
    assert.ok(
        send_button_disabled,
        "Send button should be disabled when user cannot send DMs",
    );
});

test_ui("dm_permission_banner_not_shown_when_permitted", ({mock_template, override}) => {
    // Test that when user CAN send DMs, no restriction banner is shown.

    override(current_user, "user_id", me.user_id);
    override(realm, "realm_can_access_all_users_group", everyone.id);
    // Allow everyone to send DMs
    override(realm, "realm_direct_message_initiator_group", everyone.id);
    override(realm, "realm_direct_message_permission_group", everyone.id);

    initialize_pm_pill(mock_template);

    // Set up compose state for DM
    compose_state.set_message_type("private");
    compose_state.private_message_recipient_emails("other@example.com");

    // Track banner rendering
    let dm_restriction_banner_shown = false;
    mock_template("compose_banner/cannot_send_direct_message_error.hbs", false, () => {
        dm_restriction_banner_shown = true;
        return "<banner-stub>";
    });
    mock_template("compose_banner/compose_banner.hbs", false, () => "<banner-stub>");

    // Call validate_and_update_send_button_status
    compose_validate.validate_and_update_send_button_status();

    // Verify no DM restriction banner was shown
    assert.ok(
        !dm_restriction_banner_shown,
        "DM restriction banner should not be shown when user can send DMs",
    );

    // Verify send button is NOT disabled
    assert.ok(
        !send_button_disabled,
        "Send button should not be disabled when user can send DMs",
    );
});

test_ui("banner_consistency_after_recipient_change", ({mock_template, override}) => {
    // This test simulates changing from a permitted stream to a restricted stream
    // and verifies the banner correctly updates.
    //
    // The bug would cause the banner to show stale state because the banner
    // check ran BEFORE validation set the new posting_policy_error_message.

    override(current_user, "user_id", me.user_id);
    override(realm, "realm_can_access_all_users_group", everyone.id);

    // Create two streams: one open, one restricted
    const open_stream = {
        stream_id: 203,
        name: "open-stream",
        subscribed: true,
        can_send_message_group: everyone.id,
    };

    const restricted_stream = {
        stream_id: 204,
        name: "restricted-stream",
        subscribed: true,
        can_send_message_group: admin.id,
    };

    stream_data.add_sub_for_tests(open_stream);
    stream_data.add_sub_for_tests(restricted_stream);

    // Track banner state
    let no_post_permission_banner_shown = false;
    mock_template("compose_banner/compose_banner.hbs", false, (data) => {
        if (data.classname === compose_banner.CLASSNAMES.no_post_permissions) {
            no_post_permission_banner_shown = true;
        }
        return "<banner-stub>";
    });

    // Start with open stream
    compose_state.set_message_type("stream");
    compose_state.set_stream_id(open_stream.stream_id);
    compose_state.topic("test-topic");

    // Validate - should NOT show permission error
    no_post_permission_banner_shown = false;
    compose_validate.validate_and_update_send_button_status();
    assert.ok(
        !no_post_permission_banner_shown,
        "No permission banner should be shown for open stream",
    );

    // Now change to restricted stream
    compose_state.set_stream_id(restricted_stream.stream_id);

    // Validate again - should show permission error
    // In the buggy code, the banner might show stale state here
    no_post_permission_banner_shown = false;
    compose_validate.validate_and_update_send_button_status();
    assert.ok(
        no_post_permission_banner_shown,
        "Permission banner should be shown after switching to restricted stream",
    );
});

test_ui("send_button_state_matches_validation", ({mock_template, override}) => {
    // Verify that send button disabled state is consistent with validation result
    // and that the banner state matches.

    override(current_user, "user_id", me.user_id);
    override(realm, "realm_can_access_all_users_group", everyone.id);

    const restricted_stream = {
        stream_id: 205,
        name: "restricted",
        subscribed: true,
        can_send_message_group: admin.id,
    };
    stream_data.add_sub_for_tests(restricted_stream);

    let banner_shown = false;
    mock_template("compose_banner/compose_banner.hbs", false, (data) => {
        if (data.classname === compose_banner.CLASSNAMES.no_post_permissions) {
            banner_shown = true;
        }
        return "<banner-stub>";
    });

    compose_state.set_message_type("stream");
    compose_state.set_stream_id(restricted_stream.stream_id);
    compose_state.topic("test");

    // Clear any previous state
    send_button_disabled = false;
    banner_shown = false;

    // Call the function
    compose_validate.validate_and_update_send_button_status();

    // Both should indicate user cannot send
    assert.ok(
        send_button_disabled === banner_shown,
        "Send button disabled state should match whether banner is shown",
    );
    assert.ok(send_button_disabled, "Send button should be disabled for restricted stream");
    assert.ok(banner_shown, "Banner should be shown for restricted stream");
});

